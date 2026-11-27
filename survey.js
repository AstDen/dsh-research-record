/**
 * Adopting an existing research project.
 *
 * The case this exists for: a directory someone has worked in for years. Half of
 * it is a finished study with negative results, part is an experiment nobody
 * wrote up, part is the thing they are working on now — and the person asking
 * cannot always say which is which any more.
 *
 * So the plugin does not restructure anything by itself. It walks the tree once,
 * writes a map (and optionally a marker per directory, so the graph survives a
 * `cd`), extracts the facts that are certain from the files themselves (a table
 * with these columns, a PDF, a LaTeX manuscript, a notebook with N cells), and
 * writes an archival journal that separates three different kinds of statement:
 *
 *   факт   — what is in the directory, with the path as evidence;
 *   оценка — what it probably is (a draft, an abandoned run), marked as a guess;
 *   план   — how to fit in, in one of three modes, strongest fit first.
 *
 * Nothing is moved, renamed or deleted. The adoption plan lists candidate moves
 * and the model performs them one at a time with the user's approval, because
 * only the owner can tell a superseded run from the one that produced the figure.
 */
import { mkdir, open, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'

import { activeWorkspace } from './notebook.js'
import { assignRoles, loadPacks, mergeExtensions, skeletonForRoles, sniffBuffer, unknownNames } from './packs.js'

export const name = 'research-record-adopt'
export const inject = ['tools']

const MAP_DIR = join('.dsh', 'map')
const MAP_MD = 'map.md'
const TREE_JSON = 'tree.json'
const ARCHIVAL_MD = 'archival-journal.md'
const SKIP_DIRS = new Set(['node_modules', 'vendor', '__pycache__', 'dist', 'site-packages', '.venv', 'venv', 'env'])
const SKIP_DIR_PREFIX = ['.git', '.hg', '.svn', '.dsh', '.ipynb_checkpoints', '.cache', '.idea', '.vscode']

/** Extension → what the file is, for the map and for the fact extraction. */
export const KINDS = {
  table: ['csv', 'tsv', 'xlsx', 'xls', 'ods', 'dat'],
  pdf: ['pdf'],
  image: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'svg', 'bmp', 'webp'],
  tex: ['tex', 'bib', 'cls', 'sty'],
  notebook: ['ipynb'],
  code: ['py', 'm', 'js', 'ts', 'r', 'jl', 'sh', 'slurm', 'c', 'cpp', 'f90', 'jou'],
  document: ['docx', 'doc', 'pptx', 'ppt', 'odt', 'rtf', 'md', 'txt'],
  config: ['xml', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'in', 'inp'],
  mesh: ['msh', 'stl', 'cas', 'cas.h5', 'dat.h5', 'trn', 'msh2', 'geo', 'jou'],
  binary: ['h5', 'hdf5', 'npy', 'npz', 'root', 'mat', 'vtk', 'vtu', 'pvtu', 'raw', 'tiff64'],
  archive: ['zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'bz2', 'xz'],
  log: ['log', 'out', 'err', 'txt~'],
}

const EXTENSION_KIND = new Map()
for (const [kind, extensions] of Object.entries(KINDS)) {
  for (const extension of extensions) EXTENSION_KIND.set(extension, kind)
}

/** `cas.h5` and `dat.h5` are OpenFOAM mesh/field files, not generic HDF5. */
export function kindOf(fileName, extensions = EXTENSION_KIND) {
  const lower = String(fileName).toLowerCase()
  if (lower.endsWith('.cas.h5') || lower.endsWith('.dat.h5')) return extensions.get('cas.h5') ?? 'mesh'
  const extension = extname(lower).replace(/^\./, '')
  if (extension.length === 0) return 'other'
  return extensions.get(extension) ?? 'other'
}

const RUN_PATTERN = /(^|[^a-z])(run|case|task|exp|experiment|вариант|вар|прогон|test)[-_ .]?\d*/i
const PAPER_PATTERN = /(paper|article|manuscript|draft|статья|статьи|рукопись|thesis|диссертац)/i
const LIT_PATTERN = /(literature|refs?|bibliograph|обзор|литератур|источник)/i

export function classifyTree() {
  return Object.keys(KINDS)
}

function toPosix(value) {
  return value.split(sep).join('/')
}

/**
 * Walk a directory without ever leaving it.
 *
 * Limits are hard and reported: a 150 000-file tree must produce a map in a
 * minute, and the map must say plainly that it stopped early instead of
 * pretending the tree ends where the walk ended.
 */
export async function walkTree(root, { maxDepth = 6, maxFiles = 20000, maxDirs = 2000, markers = false, markerName = '.dsh-map.json', packs } = {}) {
  const absoluteRoot = resolve(root)
  const domainPacks = Array.isArray(packs) ? packs : loadPacks(absoluteRoot)
  const extensions = mergeExtensions(KINDS, domainPacks)
  const nodes = []
  const skippedDirectories = []
  let filesSeen = 0
  let truncated = false
  const queue = [{ path: absoluteRoot, depth: 0 }]

  while (queue.length > 0) {
    const current = queue.shift()
    if (nodes.length >= maxDirs) {
      truncated = true
      break
    }
    let entries = []
    try {
      entries = await readdir(current.path, { withFileTypes: true })
    } catch (error) {
      skippedDirectories.push({ path: toPosix(relative(absoluteRoot, current.path)) || '.', reason: String(error?.code ?? error) })
      continue
    }
    const node = {
      path: toPosix(relative(absoluteRoot, current.path)) || '.',
      depth: current.depth,
      files: 0,
      dirs: 0,
      bytes: 0,
      kinds: {},
      samples: [],
      latest: '',
      hasReadme: false,
      names: [],
      otherNames: [],
      otherCounts: {},
      unknownSamples: [],
    }
    for (const entry of entries) {
      const entryPath = join(current.path, entry.name)
      if (entry.isDirectory()) {
        const lower = entry.name.toLowerCase()
        if (SKIP_DIRS.has(lower) || SKIP_DIR_PREFIX.some((prefix) => lower.startsWith(prefix))) continue
        node.dirs += 1
        if (current.depth + 1 <= maxDepth) queue.push({ path: entryPath, depth: current.depth + 1 })
        else node.truncatedDepth = true
        continue
      }
      if (!entry.isFile()) continue
      if (filesSeen >= maxFiles) {
        truncated = true
        break
      }
      filesSeen += 1
      const kind = kindOf(entry.name, extensions)
      node.files += 1
      node.kinds[kind] = (node.kinds[kind] ?? 0) + 1
      if (/^readme/i.test(entry.name)) node.hasReadme = true
      node.names.push(entry.name)
      if (kind === 'other') {
        if (node.otherNames.length < 40) node.otherNames.push(entry.name)
        node.otherCounts[entry.name] = (node.otherCounts[entry.name] ?? 0) + 1
        if (node.unknownSamples.length < 8) node.unknownSamples.push(entry.name)
      }
      if (node.samples.length < 6) node.samples.push(entry.name)
      try {
        const info = await stat(entryPath)
        node.bytes += info.size
        const at = new Date(info.mtimeMs).toISOString()
        if (at > node.latest) node.latest = at
      } catch {
        /* a file that vanished during the walk is not an error */
      }
    }
    node.signature = signatureOf(node)
    nodes.push(node)
    if (markers) {
      try {
        await writeFile(join(current.path, markerName), JSON.stringify({
          v: 1,
          path: node.path,
          files: node.files,
          kinds: node.kinds,
          latest: node.latest,
          generated: new Date().toISOString(),
        }, null, 2) + '\n')
      } catch {
        /* a read-only subdirectory simply gets no marker */
      }
    }
  }

  const map = {
    root: absoluteRoot,
    nodes,
    truncated,
    filesSeen,
    skippedDirectories,
    markersWritten: markers,
    extensions: Object.fromEntries([...extensions.entries()]),
  }
  map.sniffed = await sniffUnknowns(map, { budget: 400 })
  const assigned = assignRoles(map, domainPacks)
  map.patchedKinds = assigned.patched.length
  return map
}

/**
 * Read the first bytes of extension-free files and let the bytes, not the name,
 * decide. Bounded: a tree with 60 000 nameless files must not open 60 000 of them.
 */
async function sniffUnknowns(map, { budget = 400 } = {}) {
  let used = 0
  let patched = 0
  for (const node of map.nodes) {
    if (used >= budget) break
    if (node.unknownSamples.length === 0) continue
    const directory = join(map.root, node.path === '.' ? '' : node.path)
    for (const name of [...node.unknownSamples]) {
      if (used >= budget) break
      used += 1
      const kind = await sniffFile(join(directory, name))
      // "text" is not a finding: every unknown file that is not binary reads as
      // text. Counting it would hide the names the owner actually needs to see.
      if (kind === null || kind === 'text') continue
      const moved = Math.min(node.kinds.other ?? 0, node.otherCounts?.[name] ?? 1)
      if (moved === 0) continue
      node.kinds.other = (node.kinds.other ?? 0) - moved
      if ((node.kinds.other ?? 0) === 0) delete node.kinds.other
      node.kinds[kind] = (node.kinds[kind] ?? 0) + moved
      if (node.otherCounts !== undefined) delete node.otherCounts[name]
      node.otherNames = node.otherNames.filter((item) => item !== name)
      node.sniffed = node.sniffed ?? []
      node.sniffed.push({ name, kind })
      patched += 1
    }
  }
  map.sniffBudget = budget
  return patched
}

async function sniffFile(path) {
  let handle
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.alloc(512)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return sniffBuffer(buffer.subarray(0, bytesRead))
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

function signatureOf(node) {
  const parts = []
  if (node.hasReadme) parts.push('readme')
  if (RUN_PATTERN.test(node.path)) parts.push('run-like')
  if (PAPER_PATTERN.test(node.path)) parts.push('paper-like')
  if (LIT_PATTERN.test(node.path)) parts.push('literature-like')
  if (node.files === 0 && node.dirs === 0) parts.push('empty')
  const dominant = Object.entries(node.kinds).sort((left, right) => right[1] - left[1])[0]
  if (dominant !== undefined && node.files > 0) {
    const share = dominant[1] / node.files
    if (share >= 0.6) parts.push(`mostly-${dominant[0]}`)
  }
  return parts
}

/** Two text lines are enough to say what a table holds; the whole file is not. */
async function readHead(path, bytes = 400) {
  let handle
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size === 0) return ''
    handle = await open(path, 'r')
    const buffer = Buffer.alloc(Math.min(bytes, info.size))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch {
    return ''
  } finally {
    await handle?.close().catch(() => {})
  }
}

/**
 * Facts that are certain, because a file proves them.
 *
 * Each fact is `{ kind, path, text }`; the archival journal prints them as a
 * list the model can check. Nothing here is an interpretation — "this table has
 * these columns" is a fact, "this table is the main result" is not.
 */
export async function extractFacts(root, map, { maxFacts = 40 } = {}) {
  const facts = []
  const absoluteRoot = map.root ?? resolve(root)
  for (const node of map.nodes) {
    if (facts.length >= maxFacts) break
    const directory = join(absoluteRoot, node.path === '.' ? '' : node.path)
    for (const sample of node.samples) {
      if (facts.length >= maxFacts) break
      const kind = kindOf(sample)
      const path = toPosix(join(node.path === '.' ? '' : node.path, sample))
      if (kind === 'table' && /\.(csv|tsv)$/i.test(sample)) {
        const head = await readHead(join(directory, sample))
        const header = head.split('\n')[0]?.trim() ?? ''
        if (header.length > 0) {
          const columns = header.split(/[,;\t]/).map((cell) => cell.trim().replace(/^"|"$/g, ''))
          facts.push({ kind: 'table', path, text: `таблица с колонками: ${columns.slice(0, 8).join(', ')}${columns.length > 8 ? `, … (${columns.length} колонок)` : ''}` })
        }
      } else if (kind === 'table' && /\.(xlsx|xls|ods)$/i.test(sample)) {
        facts.push({ kind: 'table', path, text: 'книга таблиц (xlsx) — колонки не читались, открой через data_profile' })
      } else if (kind === 'tex' && /\.tex$/i.test(sample)) {
        const head = await readHead(join(directory, sample), 4000)
        const title = head.match(/\\title\{([^}]{3,120})\}/)?.[1]
        facts.push({ kind: 'tex', path, text: title === undefined ? 'LaTeX-файл (без \\title)' : `LaTeX-файл, заголовок: «${title}»` })
      } else if (kind === 'notebook') {
        const head = await readHead(join(directory, sample), 200_000)
        const cells = (head.match(/"cell_type"/g) ?? []).length
        facts.push({ kind: 'notebook', path, text: `Jupyter-ноутбук, ячеек в начале файла: ${cells}` })
      } else if (kind === 'pdf') {
        facts.push({ kind: 'pdf', path, text: 'PDF (страницы и текст — через pdf_info)' })
      } else if (kind === 'image') {
        facts.push({ kind: 'image', path, text: 'изображение/рисунок' })
      } else if (kind === 'mesh') {
        facts.push({ kind: 'mesh', path, text: 'сетка/расчётный файл (msh, stl, cas/dat, trn)' })
      } else if (kind === 'archive') {
        facts.push({ kind: 'archive', path, text: 'архив — содержимое не распаковано' })
      } else if (kind === 'binary') {
        facts.push({ kind: 'binary', path, text: 'двоичные данные (h5/npy/vtk)' })
      } else if (kind === 'code') {
        facts.push({ kind: 'code', path, text: 'скрипт' })
      }
    }
  }
  return facts
}

export function summarizeMap(map) {
  const byKind = {}
  let files = 0
  let bytes = 0
  const notable = { runLike: [], paperLike: [], literatureLike: [], empty: [], readme: [] }
  for (const node of map.nodes) {
    files += node.files
    bytes += node.bytes
    for (const [kind, count] of Object.entries(node.kinds)) byKind[kind] = (byKind[kind] ?? 0) + count
    if (node.signature.includes('run-like')) notable.runLike.push(node.path)
    if (node.signature.includes('paper-like')) notable.paperLike.push(node.path)
    if (node.signature.includes('literature-like')) notable.literatureLike.push(node.path)
    if (node.signature.includes('empty')) notable.empty.push(node.path)
    if (node.hasReadme) notable.readme.push(node.path)
  }
  const roles = {}
  for (const node of map.nodes) roles[node.role ?? 'mixed'] = (roles[node.role ?? 'mixed'] ?? 0) + 1
  return {
    directories: map.nodes.length,
    files,
    bytes,
    byKind,
    notable,
    roles,
    packs: map.packs ?? [],
    unknownNames: map.unknownNames ?? [],
    wording: map.wording ?? {},
    sniffed: map.sniffed ?? 0,
    patchedKinds: map.patchedKinds ?? 0,
    truncated: map.truncated,
    skipped: map.skippedDirectories.length,
    depthReached: Math.max(0, ...map.nodes.map((node) => node.depth)),
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`
}

export function renderMap(map, summary) {
  const lines = []
  lines.push(`# Карта проекта: ${basename(map.root)}`)
  lines.push('')
  lines.push(`Каталогов: ${summary.directories} · файлов: ${summary.files} · объём: ${formatBytes(summary.bytes)} · глубина: ${summary.depthReached}` +
    (summary.truncated ? ' · ВНИМАНИЕ: обход остановлен по лимиту' : ''))
  if (summary.skipped > 0) lines.push(`Не прочитано каталогов: ${summary.skipped}`)
  lines.push('')
  lines.push('## Что в дереве по типам')
  for (const [kind, count] of Object.entries(summary.byKind).sort((left, right) => right[1] - left[1])) {
    lines.push(`- ${kind}: ${count}`)
  }
  lines.push('')
  lines.push('## Домен (по признакам, а не по названию)')
  if (summary.packs.length === 0) {
    lines.push('- домен не определён: признаков ниже 5 % — далее работает только универсальный словарь ролей')
  } else {
    for (const hit of summary.packs) {
      lines.push(`- ${hit.id} — ${Math.round(hit.share * 100)} % файлов (${hit.evidence.join(', ')})`)
    }
  }
  lines.push('')
  lines.push('## Роли каталогов')
  for (const [role, count] of Object.entries(summary.roles).sort((left, right) => right[1] - left[1])) {
    const examples = map.nodes.filter((node) => (node.role ?? 'mixed') === role).slice(0, 4).map((node) => (node.path === '.' ? '.' : node.path))
    lines.push(`- ${role}: ${count}${examples.length > 0 ? ` — ${examples.join(', ')}` : ''}`)
  }
  lines.push('')
  lines.push('## Дерево')
  for (const node of map.nodes) {
    const indent = '  '.repeat(Math.min(node.depth, 8))
    const icons = []
    const dominant = Object.entries(node.kinds).sort((left, right) => right[1] - left[1])[0]
    if (dominant !== undefined && node.files > 0) icons.push(dominant[0])
    const marks = node.signature.filter((tag) => tag !== `mostly-${dominant?.[0]}`)
    const name = node.path === '.' ? '.' : basename(node.path)
    lines.push(`${indent}${name}/  ${node.files}ф${node.bytes > 0 ? ` ${formatBytes(node.bytes)}` : ''}` +
      `${icons.length > 0 ? ` [${icons.join(',')}]` : ''}` +
      `${node.role !== undefined ? ` {${node.role}}` : ''}` +
      `${marks.length > 0 ? ` (${marks.join(', ')})` : ''}`)
    if (node.samples.length > 0) lines.push(`${indent}    ${node.samples.slice(0, 4).join(' · ')}`)
  }
  if (summary.notable.empty.length > 0) {
    lines.push('')
    lines.push(`Пустые каталоги (${summary.notable.empty.length}): ${summary.notable.empty.slice(0, 10).join(', ')}`)
  }
  if (summary.unknownNames.length > 0) {
    lines.push('')
    lines.push('## Что не опознано (кандидаты в пак своей области)')
    lines.push(summary.unknownNames.slice(0, 15).map((item) => `${item.name} ×${item.count}`).join(' · '))
    lines.push('')
    lines.push(`Если это важные файлы, добавь соответствие в \`<проект>/.dsh/packs/*.json\` — код менять не нужно.`)
  }
  return lines.join('\n')
}

/**
 * The three ways of fitting in, strongest fit first.
 *
 * `as-is` is the strongest fit: nothing changes, the bundle only adds its own
 * `.dsh/` and a pointer file, so an established colleague keeps their tree.
 * `light` adds the standard directories next to the existing ones and an index
 * that says which existing files belong to each, without moving anything.
 * `restructure` lists the moves that would produce a clean project — a plan, not
 * an action, because the owner is the only one who can tell a dead run from the
 * one behind a published figure.
 */
export function planAdoption(map, summary, { mode = 'light' } = {}) {
  const plan = { mode, creates: [], moves: [], keeps: [], archive: null, questions: [], domain: summary.packs ?? [] }
  const roles = summary.roles ?? {}
  const skeleton = skeletonForRoles(roles, summary.wording ?? {})
  const present = new Set(map.nodes.filter((node) => node.depth <= 1 && node.path !== '.').map((node) => basename(node.path).toLowerCase()))
  const work = map.nodes
    .filter((node) => node.path !== '.' && ['run', 'paper', 'literature'].includes(node.role) && (node.subtreeFiles ?? 0) > 0)
    .sort((left, right) => (right.subtreeFiles ?? 0) - (left.subtreeFiles ?? 0))
  const KEEP_LIMIT = 12
  const capped = (list) => (list.length <= KEEP_LIMIT ? list : [...list.slice(0, KEEP_LIMIT), `… ещё ${list.length - KEEP_LIMIT} каталогов — полный список в plan-${mode}.json`])
  const create = (path, reason) => plan.creates.push({ path, reason })

  if (mode === 'as-is') {
    create('.dsh/map/', 'карта, архивный журнал, снимок путей')
    create('AGENTS.md', 'указатель на карту, если файла ещё нет')
    create('.dsh/policy.json', 'защита сырых данных')
    plan.keeps.push('вся существующая структура остаётся как есть; стандартные папки не создаются')
    plan.questions.push('какие каталоги считать «в работе» — по ним строится индекс, ничего не перемещается')
    return plan
  }

  if (work.length > 0) {
    for (const line of capped(work.map((node) => `${node.path}/ — ${node.role} (${node.roleReason ?? 'признак не записан'})`))) plan.keeps.push(line)
  }
  if (mode === 'light') {
    for (const entry of skeleton) {
      const top = entry.path.includes('/') ? entry.path.slice(0, entry.path.indexOf('/')) : entry.path
      if (present.has(top.toLowerCase()) && entry.path === top) plan.keeps.push(`${top}/ уже есть — не трогаем`)
      else create(entry.path, entry.reason)
    }
    create('.dsh/map/', 'карта, архивный журнал, снимок путей')
    create('.dsh/policy.json', 'защита сырых данных')
    create('AGENTS.md', 'указатель на карту, если файла ещё нет')
    plan.questions.push('какие из существующих каталогов — текущая работа, а какие архив')
    return plan
  }

  // restructure: skeleton + a move list, still a plan, never an action
  const buckets = { tables: 0, pdfs: 0, tex: 0, images: 0, meshes: 0, fields: 0 }
  for (const node of map.nodes) {
    buckets.tables += node.kinds.table ?? 0
    buckets.pdfs += node.kinds.pdf ?? 0
    buckets.tex += node.kinds.tex ?? 0
    buckets.images += node.kinds.image ?? 0
    buckets.meshes += (node.kinds.mesh ?? 0) + (node.kinds.geometry ?? 0)
    buckets.fields += (node.kinds.field ?? 0) + (node.kinds.post ?? 0)
  }
  const stamp = new Date().toISOString().slice(0, 10)
  plan.archive = `archive/${stamp}/`
  for (const entry of skeleton) create(entry.path, entry.reason)
  create('.dsh/map/', 'карта, архивный журнал, снимок путей')
  create('.dsh/policy.json', 'защита сырых данных')
  plan.moves.push({ from: '—', to: 'literature/refs/', what: 'PDF и .bib из literature-каталогов', count: buckets.pdfs, requiresApproval: true })
  plan.moves.push({ from: '—', to: 'runs/<id>/results/', what: 'таблицы и логи из run-каталогов', count: buckets.tables, requiresApproval: true })
  plan.moves.push({ from: '—', to: 'analysis/figures/', what: 'рисунки, созданные скриптом', count: buckets.images, requiresApproval: true })
  plan.moves.push({ from: '—', to: 'paper/', what: 'LaTeX и черновики', count: buckets.tex, requiresApproval: true })
  plan.moves.push({ from: '—', to: 'models/', what: 'сетки и геометрия', count: buckets.meshes, requiresApproval: true })
  plan.moves.push({ from: '—', to: `${plan.archive}`, what: 'снимок путей и хешей (не копия файлов), чтобы вернуть всё назад', count: buckets.fields, requiresApproval: false })
  plan.keeps.push('сырые данные не перемещаются: data/raw/** под защитой, работа идёт на копиях')
  plan.keeps.push('архивы (.zip/.tar) остаются на месте, пока владелец не скажет, что внутри')
  plan.questions.push('по какому признаку отличать «текущую работу» от «брошенного» — дата, README, наличие статьи?')
  plan.questions.push('что из результатов опубликовано и не должно двигаться')
  return plan
}

export function renderPlan(plan, summary) {
  const lines = []
  const titles = {
    'as-is': 'Встроиться как есть (ничего не переделывать)',
    light: 'Встроиться легко (добавить рядом, не перемещая)',
    restructure: 'Перестроить (план перемещений, по одному с подтверждением)',
  }
  lines.push(`## Режим: ${titles[plan.mode] ?? plan.mode}`)
  if ((plan.domain ?? []).length > 0) {
    lines.push(`Домен: ${plan.domain.map((hit) => `${hit.id} ${Math.round(hit.share * 100)} %`).join(', ')}`)
  }
  if (plan.creates.length > 0) {
    lines.push('Создать:')
    for (const item of plan.creates) {
      if (typeof item === 'string') lines.push(`  + ${item}`)
      else lines.push(`  + ${item.path}  — ${item.reason}`)
    }
  }
  if (plan.moves.length > 0) {
    lines.push('Кандидаты на перенос (только с подтверждением владельца):')
    for (const move of plan.moves) lines.push(`  → ${move.to}  ${move.what}  (${move.count} файлов)`)
  }
  if (plan.keeps.length > 0) {
    lines.push('Не трогаем:')
    for (const item of plan.keeps) lines.push(`  · ${item}`)
  }
  if (plan.questions.length > 0) {
    lines.push('Спросить владельца:')
    for (const item of plan.questions) lines.push(`  ? ${item}`)
  }
  if (summary.truncated) lines.push('', 'ВНИМАНИЕ: дерево обойдено не полностью — план предварительный.')
  return lines.join('\n')
}

const JOURNAL_CAP = 64_000

export function renderArchivalJournal({ map, summary, facts, plans, root }) {
  const lines = []
  lines.push(`# Архивный лабораторный журнал · ${basename(root)}`)
  lines.push('')
  lines.push(`Составлен: ${new Date().toISOString().slice(0, 10)} · прочитано каталогов ${summary.directories}, файлов ${summary.files}`)
  lines.push('')
  lines.push('Три вида утверждений, которые здесь разделены намеренно: **факт** — то, что')
  lines.push('подтверждается файлом и путём к нему; **оценка** — догадка о смысле, помечена;')
  lines.push('**план** — что сделать со структурой. Оценки не превращаются в факты без проверки.')
  lines.push('')
  lines.push('## 1. Карта')
  lines.push('')
  lines.push(`См. \`${MAP_MD}\` рядом (полное дерево) и \`${TREE_JSON}\` (машиночитаемые узлы).`)
  lines.push('')
  lines.push(`- каталогов: ${summary.directories}, файлов: ${summary.files}, объём: ${formatBytes(summary.bytes)}`)
  lines.push(`- по типам: ${Object.entries(summary.byKind).sort((left, right) => right[1] - left[1]).map(([kind, count]) => `${kind} ${count}`).join(' · ')}`)
  if ((summary.packs ?? []).length > 0) {
    lines.push(`- домен: ${summary.packs.map((hit) => `${hit.id} ${Math.round(hit.share * 100)} % (${hit.evidence.join(', ')})`).join(' · ')}`)
  } else {
    lines.push('- домен не определён: признаков ниже 5 %, работает только универсальный словарь ролей')
  }
  const roleLine = Object.entries(summary.roles ?? {}).sort((left, right) => right[1] - left[1]).map(([role, count]) => `${role} ${count}`).join(' · ')
  if (roleLine.length > 0) lines.push(`- роли каталогов: ${roleLine}`)
  if ((summary.sniffed ?? 0) > 0) lines.push(`- опознано по первым байтам (не по расширению): ${summary.sniffed} файлов`)
  const runDirs = map.nodes.filter((node) => node.role === 'run').map((node) => node.path)
  const paperDirs = map.nodes.filter((node) => node.role === 'paper').map((node) => node.path)
  const litDirs = map.nodes.filter((node) => node.role === 'literature').map((node) => node.path)
  if (runDirs.length > 0) lines.push(`- каталоги-прогоны (${runDirs.length}): ${runDirs.slice(0, 8).join(', ')}`)
  if (paperDirs.length > 0) lines.push(`- каталоги со статьёй/черновиком (${paperDirs.length}): ${paperDirs.slice(0, 8).join(', ')}`)
  if (litDirs.length > 0) lines.push(`- литература (${litDirs.length}): ${litDirs.slice(0, 8).join(', ')}`)
  if (summary.notable.empty.length > 0) lines.push(`- пустые каталоги (${summary.notable.empty.length}): ${summary.notable.empty.slice(0, 8).join(', ')}`)
  if ((summary.unknownNames ?? []).length > 0) {
    lines.push(`- не опознано (топ-10): ${summary.unknownNames.slice(0, 10).map((item) => `${item.name} ×${item.count}`).join(' · ')}`)
  }
  lines.push('')
  lines.push('## 2. Факты (подтверждаются файлами)')
  lines.push('')
  if (facts.length === 0) lines.push('- ничего не разобрано: в дереве нет файлов известных типов')
  for (const fact of facts) lines.push(`- \`${fact.path}\` — ${fact.text}`)
  lines.push('')
  lines.push('## 3. Оценки (догадки, требуют подтверждения владельцем)')
  lines.push('')
  lines.push('- роль каталога выведена из состава файлов, а не из его названия: имя только повышает приоритет')
  lines.push('- каталог-прогон обычно означает серию вариантов; какой из них итоговый — знает только владелец')
  lines.push('- каталог со статьёй обычно содержит незаконченную рукопись; проверить дату и наличие рисунков')
  lines.push('- «пустой каталог» может быть заготовкой, а может — потерянным результатом (проверить историю git)')
  lines.push('- таблицы и рисунки без статьи и без журнала — типичный случай «сделано, но не описано»')
  lines.push('')
  lines.push('## 4. План встраивания')
  lines.push('')
  for (const plan of plans) {
    lines.push(renderPlan(plan, summary))
    lines.push('')
  }
  lines.push('## 5. Как переносить (если выбран третий режим)')
  lines.push('')
  lines.push('1. Сначала снимок: `tree.json` уже содержит пути; хеши не нужны, чтобы вернуть всё назад.')
  lines.push('2. Переносить по одному каталогу, с записью `decision` в журнал: что, откуда, куда и почему.')
  lines.push('3. Сырые данные (`data/raw/**`) не двигать: они под защитой guard-а, работа — на копиях.')
  lines.push('4. После каждого шага — `notebook_verify`, чтобы цепочка осталась целой.')
  lines.push('')
  lines.push('## 6. Что спросить у владельца')
  lines.push('')
  lines.push('- какой каталог — текущая работа (его берём в индекс первым)')
  lines.push('- что уже опубликовано и не должно двигаться')
  lines.push('- где сырые данные, которые нельзя трогать')
  lines.push('- есть ли результаты, которые «не получились» и их надо сохранить как есть')
  lines.push('- какие каталоги из списка «не трогаем» на самом деле архив')
  const text = lines.join('\n')
  if (text.length <= JOURNAL_CAP) return text
  const cut = text.slice(0, JOURNAL_CAP)
  const lastBreak = cut.lastIndexOf('\n')
  return `${cut.slice(0, lastBreak)}\n\n… журнал сокращён по бюджету ${Math.round(JOURNAL_CAP / 1000)} КБ: полные списки — в map.md и tree.json, размеры планов — в plan-*.json`
}

async function mapPaths(workspace) {
  const directory = join(workspace, MAP_DIR)
  await mkdir(directory, { recursive: true })
  return {
    directory,
    mapFile: join(directory, MAP_MD),
    treeFile: join(directory, TREE_JSON),
    archivalFile: join(directory, ARCHIVAL_MD),
  }
}

/**
 * Write, and record the failure instead of throwing.
 *
 * A project often lives outside the writable sandbox (`/mnt/...` mounted
 * read-only, a colleague's home): the map still belongs to the workspace, and
 * saying "AGENTS.md could not be written, EROFS" is more useful than a crash
 * half-way through adoption.
 */
async function attempt(list, label, action) {
  try {
    await action()
    return true
  } catch (error) {
    list.push({ path: label, reason: String(error?.code ?? error?.message ?? error) })
    return false
  }
}

async function ensureFile(path, content) {
  try {
    await stat(path)
    return 'kept'
  } catch {
    await writeFile(path, content)
    return 'created'
  }
}

const AGENTS_POINTER = `# Инструкции для этого каталога

Это существующий научный проект. Его структура сложилась до подключения
harness'а и **не переделывается без решения владельца**.

Карта проекта и архивный журнал лежат в \`.dsh/map/\`:

- \`.dsh/map/map.md\` — что где лежит (дерево, типы файлов, объёмы);
- \`.dsh/map/tree.json\` — те же узлы для инструментов;
- \`.dsh/map/archival-journal.md\` — факты, оценки и план встраивания.

Правила работы в этом каталоге:

1. Прежде чем читать дерево руками, посмотри карту — она уже построена.
2. Файлы не переименовывать и не перемещать без явного разрешения владельца.
3. Сырые данные читать, работу вести на копиях; защищённые пути — в \`.dsh/policy.json\`.
4. Всё, что считается, считается скриптом; всё, что утверждается, подтверждается путём.
`

const POLICY = {
  protectedPaths: ['data/raw/**', 'data/**', '**/raw/**'],
  destructiveConfirm: true,
}

export async function adoptProject(workspace, { root, mode = 'light', markers = false, apply = false, maxFiles = 20000, maxDepth = 6, markerName = '.dsh-map.json' } = {}) {
  const target = resolve(root ?? workspace)
  const map = await walkTree(target, { markers, maxFiles, maxDepth, markerName })
  const summary = summarizeMap(map)
  const facts = await extractFacts(target, map)
  const plans = ['as-is', 'light', 'restructure'].map((candidate) => planAdoption(map, summary, { mode: candidate }))
  const chosen = plans.find((plan) => plan.mode === mode) ?? plans[1]
  const paths = await mapPaths(workspace)
  const result = { target, summary, mode, created: [], kept: [], skipped: [], facts: facts.length, plans }
  if (!apply) {
    result.mapText = renderMap(map, summary)
    result.planText = renderPlan(chosen, summary)
    return result
  }
  const mapWritten = await attempt(result.skipped, 'map.md', () => writeFile(paths.mapFile, renderMap(map, summary) + '\n'))
  const treeWritten = await attempt(result.skipped, 'tree.json', () => writeFile(paths.treeFile, JSON.stringify({ generated: new Date().toISOString(), root: target, summary, nodes: map.nodes, facts }, null, 2) + '\n'))
  const journal = renderArchivalJournal({ map, summary, facts, plans, root: target })
  const journalWritten = await attempt(result.skipped, 'archival-journal.md', () => writeFile(paths.archivalFile, journal + '\n'))
  for (const plan of plans) {
    const planFile = join(paths.directory, `plan-${plan.mode}.json`)
    const written = await attempt(result.skipped, `plan-${plan.mode}.json`, () => writeFile(planFile, JSON.stringify(plan, null, 2) + '\n'))
    if (written) result.created.push(toPosix(relative(workspace, planFile)))
  }
  if (mapWritten) result.created.push(toPosix(relative(workspace, paths.mapFile)))
  if (treeWritten) result.created.push(toPosix(relative(workspace, paths.treeFile)))
  if (journalWritten) result.created.push(toPosix(relative(workspace, paths.archivalFile)))

  const policyPath = join(workspace, '.dsh', 'policy.json')
  const policyState = await ensureFile(policyPath, JSON.stringify(POLICY, null, 2) + '\n')
  result[policyState === 'created' ? 'created' : 'kept'].push('.dsh/policy.json')

  const agentsPath = join(target, 'AGENTS.md')
  const agentsLabel = toPosix(join(toPosix(relative(workspace, target)), 'AGENTS.md'))
  if (await attempt(result.skipped, agentsLabel, async () => {
    const state = await ensureFile(agentsPath, AGENTS_POINTER)
    result[state === 'created' ? 'created' : 'kept'].push(agentsLabel)
  }) === false) {
    /* the directory is read-only: the pointer stays unwritten and the report says so */
  }

  if (mode !== 'as-is') {
    for (const item of chosen.creates) {
      const path = typeof item === 'string' ? item : item.path
      if (path.startsWith('.') || path.startsWith('AGENTS.md')) continue
      const created = await attempt(result.skipped, `${path}/`, () => mkdir(join(target, path), { recursive: true }))
      if (created) result.created.push(`${path}/`)
    }
    const index = ['# Индекс: что уже есть в этом каталоге', '', 'Создан при встраивании. Файлы не перемещались.', '']
    for (const [kind, count] of Object.entries(summary.byKind).sort((left, right) => right[1] - left[1])) {
      index.push(`## ${kind} (${count})`)
      const examples = map.nodes.flatMap((node) => node.samples.filter((sample) => kindOf(sample) === kind).map((sample) => toPosix(join(node.path === '.' ? '' : node.path, sample)))).slice(0, 12)
      for (const example of examples) index.push(`- \`${example}\``)
      index.push('')
    }
    if (await attempt(result.skipped, 'literature/_INDEX.md', () => writeFile(join(target, 'literature', '_INDEX.md'), index.join('\n')))) {
      result.created.push('literature/_INDEX.md')
    }
  }
  result.mapText = renderMap(map, summary)
  result.planText = renderPlan(chosen, summary)
  return result
}

export function apply(ctx, config) {
  ctx.tools.register({
    name: 'project_survey',
    description:
      'Survey an existing research directory before changing anything: walk the tree (bounded), classify ' +
      'files by kind, extract the facts a file proves (table columns, LaTeX title, notebook cells), and ' +
      'return the map plus candidate facts. Read-only unless apply=true, which writes .dsh/map/map.md and ' +
      '.dsh/map/tree.json. Nothing is moved, renamed or deleted. Use this first when the user says the ' +
      'project already exists and is messy.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'directory to survey (default: the session workspace)' },
        markers: { type: 'boolean', description: 'write a small .dsh-map.json into every visited directory so the graph survives a cd (default false)' },
        marker_name: { type: 'string', description: 'marker file name (default .dsh-map.json)' },
        max_files: { type: 'integer', description: 'stop the walk after this many files (default 20000)' },
        max_depth: { type: 'integer', description: 'do not descend deeper than this (default 6)' },
        apply: { type: 'boolean', description: 'write the map files under .dsh/map/ (default false: report only)' },
      },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: `${value.mapText}\n\n${value.factsText ?? ''}` }],
    },
    async execute(args, exec) {
      const workspace = await activeWorkspace(ctx, exec)
      const target = typeof args?.path === 'string' && args.path.length > 0 ? resolve(workspace, args.path) : workspace
      const map = await walkTree(target, {
        markers: args?.markers === true,
        markerName: typeof args?.marker_name === 'string' ? args.marker_name : '.dsh-map.json',
        maxFiles: typeof args?.max_files === 'number' ? args.max_files : 20000,
        maxDepth: typeof args?.max_depth === 'number' ? args.max_depth : 6,
      })
      const summary = summarizeMap(map)
      const facts = await extractFacts(target, map)
      const mapText = renderMap(map, summary)
      const factsText = ['', '## Факты', '', ...facts.map((fact) => `- \`${fact.path}\` — ${fact.text}`)].join('\n')
      const created = []
      if (args?.apply === true) {
        const paths = await mapPaths(workspace)
        await writeFile(paths.mapFile, mapText + '\n')
        await writeFile(paths.treeFile, JSON.stringify({ generated: new Date().toISOString(), root: target, summary, nodes: map.nodes, facts }, null, 2) + '\n')
        created.push(toPosix(relative(workspace, paths.mapFile)), toPosix(relative(workspace, paths.treeFile)))
      }
      return { root: target, summary, mapText, factsText, facts: facts.length, created, roles: summary.roles, packs: summary.packs, unknownNames: summary.unknownNames, truncated: map.truncated }
    },
  })

  ctx.tools.register({
    name: 'project_adopt',
    description:
      'Plan how to fit the research bundle into an existing project, then optionally write the additive ' +
      'parts. Three modes, strongest fit first: "as-is" (change nothing, only .dsh/map + AGENTS.md pointer), ' +
      '"light" (add standard directories and an index of what exists, move nothing), "restructure" (list ' +
      'candidate moves; the moves themselves are performed one by one with the owner\'s approval, never by ' +
      'this tool). apply=true writes the map, the archival journal, policy.json, an AGENTS.md pointer and — ' +
      'for light/restructure — the standard directories plus literature/_INDEX.md. Files are never moved or ' +
      'deleted. Always show the user the three plans and let them choose.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'project directory (default: the session workspace)' },
        mode: { type: 'string', enum: ['as-is', 'light', 'restructure'], description: 'adoption mode (default light)' },
        markers: { type: 'boolean', description: 'also write a marker file into every visited directory (default false)' },
        apply: { type: 'boolean', description: 'write the additive parts (default false: plan only)' },
        max_files: { type: 'integer', description: 'walk limit (default 20000)' },
        max_depth: { type: 'integer', description: 'depth limit (default 6)' },
      },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: value.text ?? '' }],
    },
    async execute(args, exec) {
      const workspace = await activeWorkspace(ctx, exec)
      const mode = ['as-is', 'light', 'restructure'].includes(args?.mode) ? args.mode : 'light'
      const result = await adoptProject(workspace, {
        root: typeof args?.path === 'string' && args.path.length > 0 ? resolve(workspace, args.path) : workspace,
        mode,
        markers: args?.markers === true,
        apply: args?.apply === true,
        maxFiles: typeof args?.max_files === 'number' ? args.max_files : 20000,
        maxDepth: typeof args?.max_depth === 'number' ? args.max_depth : 6,
      })
      const lines = []
      lines.push(`Проект: ${result.target}`)
      lines.push(`Каталогов ${result.summary.directories} · файлов ${result.summary.files}` +
        `${result.summary.truncated ? ' · обход остановлен по лимиту' : ''}` +
        `${(result.summary.packs ?? []).length > 0 ? ` · домен: ${result.summary.packs.map((hit) => `${hit.id} ${Math.round(hit.share * 100)} %`).join(', ')}` : ' · домен не определён'}`)
      lines.push('')
      lines.push(result.planText)
      lines.push('')
      lines.push('## Три режима (выбрать с владельцем)')
      for (const plan of result.plans) {
        const title = { 'as-is': 'как есть', light: 'легко', restructure: 'перестроить' }[plan.mode]
        lines.push(`- **${title}** — создаёт ${plan.creates.length}, переносит ${plan.moves.length === 0 ? 'ничего' : `${plan.moves.length} групп файлов (по подтверждению)`}`)
      }
      if (result.skipped.length > 0) {
        lines.push('')
        lines.push('Не удалось записать (каталог вне зоны записи или запрещён):')
        for (const item of result.skipped) lines.push(`  ! ${item.path} — ${item.reason}`)
        lines.push('  Карта и журнал записаны в рабочую папку сессии; AGENTS.md и стандартные')
        lines.push('  папки в самом проекте создаст владелец или шаг с danger-full-access.')
      }
      if (result.created.length > 0) {
        lines.push('')
        lines.push('Записано:')
        for (const item of result.created) lines.push(`  + ${item}`)
        if (result.kept.length > 0) for (const item of result.kept) lines.push(`  = ${item} (уже был, не перезаписан)`)
      } else {
        lines.push('')
        lines.push('Ничего не записано: это план. Повтори с apply=true, чтобы создать карту, архивный журнал и (для light/restructure) стандартные папки.')
      }
      return { target: result.target, mode, summary: result.summary, text: lines.join('\n'), created: result.created, facts: result.facts }
    },
  })
}

export default { name, inject, apply }
