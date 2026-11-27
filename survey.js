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
 *   fact  — what is in the directory, with the path as evidence;
 *   guess — what it probably is (a draft, an abandoned run), marked as such;
 *   plan  — how to fit in, in one of three modes, strongest fit first.
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

const RUN_PATTERN = /(^|[^a-z])(run|case|task|exp|experiment|test)[-_ .]?\d*/i
const PAPER_PATTERN = /(paper|article|manuscript|draft|thesis)/i
const LIT_PATTERN = /(literature|refs?|bibliograph)/i

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
/**
 * A marker is a file NAME inside the directory it marks, never a path: a name
 * like `../OUTSIDE.md` would write into a sibling project, and `sub/notes.md`
 * would land on top of the owner's notes.
 */
function markerFileName(name) {
  const candidate = String(name ?? '').trim()
  if (candidate.length === 0) return null
  if (candidate === '.' || candidate === '..') return null
  if (candidate.includes('/') || candidate.includes('\\')) return null
  return candidate
}

export async function walkTree(root, { maxDepth = 6, maxFiles = 20000, maxDirs = 2000, markers = false, markerName = '.dsh-map.json', packs } = {}) {
  const absoluteRoot = resolve(root)
  const domainPacks = Array.isArray(packs) ? packs : loadPacks(absoluteRoot)
  const extensions = mergeExtensions(KINDS, domainPacks)
  const nodes = []
  const skippedDirectories = []
  let filesSeen = 0
  let truncated = false
  const requestedMarkers = markers === true
  const markerNameSafe = markerFileName(markerName)
  const markersEnabled = requestedMarkers && markerNameSafe !== null
  const markerRejected = requestedMarkers && markerNameSafe === null ? `marker name "${String(markerName)}" is not a bare file name; markers were not written` : undefined
  let markersSkipped = 0
  const queue = [{ path: absoluteRoot, depth: 0 }]

  while (queue.length > 0) {
    if (filesSeen >= maxFiles) {
      truncated = true
      break
    }
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
        // '.git' must skip git, not '.github'; a variant such as '.git-rewrite'
        // is skipped by the '-'-suffixed form, never by a bare prefix.
        const skipped =
          SKIP_DIRS.has(lower) || SKIP_DIR_PREFIX.some((prefix) => lower === prefix || lower.startsWith(`${prefix}-`))
        if (skipped) continue
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
    if (markersEnabled) {
      try {
        await writeFile(join(current.path, markerNameSafe), JSON.stringify({
          v: 1,
          path: node.path,
          files: node.files,
          kinds: node.kinds,
          latest: node.latest,
          generated: new Date().toISOString(),
        }, null, 2) + '\n', { flag: 'wx' })
      } catch (error) {
        if (error?.code === 'EEXIST') markersSkipped += 1
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
    markersWritten: markersEnabled,
    markersSkipped,
    markerRejected,
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
          facts.push({ kind: 'table', path, text: `table with columns: ${columns.slice(0, 8).join(', ')}${columns.length > 8 ? `, … (${columns.length} columns)` : ''}` })
        }
      } else if (kind === 'table' && /\.(xlsx|xls|ods)$/i.test(sample)) {
        facts.push({ kind: 'table', path, text: 'spreadsheet workbook (xlsx) — columns not read, open it with data_profile' })
      } else if (kind === 'tex' && /\.tex$/i.test(sample)) {
        const head = await readHead(join(directory, sample), 4000)
        const title = head.match(/\\title\{([^}]{3,120})\}/)?.[1]
        facts.push({ kind: 'tex', path, text: title === undefined ? 'LaTeX file (no \\title)' : `LaTeX file, title: "${title}"` })
      } else if (kind === 'notebook') {
        const head = await readHead(join(directory, sample), 200_000)
        const cells = (head.match(/"cell_type"/g) ?? []).length
        facts.push({ kind: 'notebook', path, text: `Jupyter notebook, cells at the start of the file: ${cells}` })
      } else if (kind === 'pdf') {
        facts.push({ kind: 'pdf', path, text: 'PDF (pages and text via pdf_info)' })
      } else if (kind === 'image') {
        facts.push({ kind: 'image', path, text: 'image/figure' })
      } else if (kind === 'mesh') {
        facts.push({ kind: 'mesh', path, text: 'mesh/solver file (msh, stl, cas/dat, trn)' })
      } else if (kind === 'archive') {
        facts.push({ kind: 'archive', path, text: 'archive — contents not unpacked' })
      } else if (kind === 'binary') {
        facts.push({ kind: 'binary', path, text: 'binary data (h5/npy/vtk)' })
      } else if (kind === 'code') {
        facts.push({ kind: 'code', path, text: 'script' })
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
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
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
  lines.push(`# Project map: ${basename(map.root)}`)
  lines.push('')
  lines.push(`Directories: ${summary.directories} · files: ${summary.files} · volume: ${formatBytes(summary.bytes)} · depth: ${summary.depthReached}` +
    (summary.truncated ? ' · WARNING: the walk stopped at the limit' : ''))
  if (summary.skipped > 0) lines.push(`Directories not read: ${summary.skipped}`)
  lines.push('')
  lines.push('## What the tree holds, by kind')
  for (const [kind, count] of Object.entries(summary.byKind).sort((left, right) => right[1] - left[1])) {
    lines.push(`- ${kind}: ${count}`)
  }
  lines.push('')
  lines.push('## Domain (from evidence, not from names)')
  if (summary.packs.length === 0) {
    lines.push('- domain not determined: every signature is below 5 % — from here only the universal role vocabulary applies')
  } else {
    for (const hit of summary.packs) {
      lines.push(`- ${hit.id} — ${Math.round(hit.share * 100)} % of files (${hit.evidence.join(', ')})`)
    }
  }
  lines.push('')
  lines.push('## Directory roles')
  for (const [role, count] of Object.entries(summary.roles).sort((left, right) => right[1] - left[1])) {
    const examples = map.nodes.filter((node) => (node.role ?? 'mixed') === role).slice(0, 4).map((node) => (node.path === '.' ? '.' : node.path))
    lines.push(`- ${role}: ${count}${examples.length > 0 ? ` — ${examples.join(', ')}` : ''}`)
  }
  lines.push('')
  lines.push('## Tree')
  for (const node of map.nodes) {
    const indent = '  '.repeat(Math.min(node.depth, 8))
    const icons = []
    const dominant = Object.entries(node.kinds).sort((left, right) => right[1] - left[1])[0]
    if (dominant !== undefined && node.files > 0) icons.push(dominant[0])
    const marks = node.signature.filter((tag) => tag !== `mostly-${dominant?.[0]}`)
    const name = node.path === '.' ? '.' : basename(node.path)
    lines.push(`${indent}${name}/  ${node.files} files${node.bytes > 0 ? ` ${formatBytes(node.bytes)}` : ''}` +
      `${icons.length > 0 ? ` [${icons.join(',')}]` : ''}` +
      `${node.role !== undefined ? ` {${node.role}}` : ''}` +
      `${marks.length > 0 ? ` (${marks.join(', ')})` : ''}`)
    if (node.samples.length > 0) lines.push(`${indent}    ${node.samples.slice(0, 4).join(' · ')}`)
  }
  if (summary.notable.empty.length > 0) {
    lines.push('')
    lines.push(`Empty directories (${summary.notable.empty.length}): ${summary.notable.empty.slice(0, 10).join(', ')}`)
  }
  if (summary.unknownNames.length > 0) {
    lines.push('')
    lines.push('## What was not recognised (candidates for a pack of your field)')
    lines.push(summary.unknownNames.slice(0, 15).map((item) => `${item.name} ×${item.count}`).join(' · '))
    lines.push('')
    lines.push(`If these files matter, add a mapping in \`<project>/.dsh/packs/*.json\` — no code change needed.`)
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
  const capped = (list) => (list.length <= KEEP_LIMIT ? list : [...list.slice(0, KEEP_LIMIT), `… ${list.length - KEEP_LIMIT} more directories — the full list is in plan-${mode}.json`])
  const create = (path, reason) => plan.creates.push({ path, reason })

  if (mode === 'as-is') {
    create('.dsh/map/', 'map, archival journal, snapshot of paths')
    create('AGENTS.md', 'pointer to the map, if the file does not exist yet')
    create('.dsh/policy.json', 'protection for raw data')
    plan.keeps.push('the whole existing structure stays as it is; no standard folders are created')
    plan.questions.push('which directories count as "in progress" — the index is built from them, nothing is moved')
    return plan
  }

  if (work.length > 0) {
    for (const line of capped(work.map((node) => `${node.path}/ — ${node.role} (${node.roleReason ?? 'reason not recorded'})`))) plan.keeps.push(line)
  }
  if (mode === 'light') {
    for (const entry of skeleton) {
      const top = entry.path.includes('/') ? entry.path.slice(0, entry.path.indexOf('/')) : entry.path
      if (present.has(top.toLowerCase()) && entry.path === top) plan.keeps.push(`${top}/ already exists — left alone`)
      else create(entry.path, entry.reason)
    }
    create('.dsh/map/', 'map, archival journal, snapshot of paths')
    create('.dsh/policy.json', 'protection for raw data')
    create('AGENTS.md', 'pointer to the map, if the file does not exist yet')
    plan.questions.push('which existing directories are current work and which are archive')
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
  create('.dsh/map/', 'map, archival journal, snapshot of paths')
  create('.dsh/policy.json', 'protection for raw data')
  plan.moves.push({ from: '—', to: 'literature/refs/', what: 'PDFs and .bib from literature directories', count: buckets.pdfs, requiresApproval: true })
  plan.moves.push({ from: '—', to: 'runs/<id>/results/', what: 'tables and logs from run directories', count: buckets.tables, requiresApproval: true })
  plan.moves.push({ from: '—', to: 'analysis/figures/', what: 'figures produced by a script', count: buckets.images, requiresApproval: true })
  plan.moves.push({ from: '—', to: 'paper/', what: 'LaTeX and drafts', count: buckets.tex, requiresApproval: true })
  plan.moves.push({ from: '—', to: 'models/', what: 'meshes and geometry', count: buckets.meshes, requiresApproval: true })
  plan.moves.push({ from: '—', to: `${plan.archive}`, what: 'snapshot of paths and hashes (not a copy of the files), so everything can be put back', count: buckets.fields, requiresApproval: false })
  plan.keeps.push('raw data is not moved: data/raw/** is protected, work happens on copies')
  plan.keeps.push('archives (.zip/.tar) stay where they are until the owner says what is inside')
  plan.questions.push('by what sign to tell "current work" from "abandoned" — date, README, the presence of a paper?')
  plan.questions.push('which results are published and must not move')
  return plan
}

export function renderPlan(plan, summary) {
  const lines = []
  const titles = {
    'as-is': 'Fit in as is (change nothing)',
    light: 'Fit in lightly (add alongside, move nothing)',
    restructure: 'Restructure (a move plan, one item at a time with confirmation)',
  }
  lines.push(`## Mode: ${titles[plan.mode] ?? plan.mode}`)
  if ((plan.domain ?? []).length > 0) {
    lines.push(`Domain: ${plan.domain.map((hit) => `${hit.id} ${Math.round(hit.share * 100)} %`).join(', ')}`)
  }
  if (plan.creates.length > 0) {
    lines.push('Create:')
    for (const item of plan.creates) {
      if (typeof item === 'string') lines.push(`  + ${item}`)
      else lines.push(`  + ${item.path}  — ${item.reason}`)
    }
  }
  if (plan.moves.length > 0) {
    lines.push('Candidates to move (owner confirmation only):')
    for (const move of plan.moves) lines.push(`  → ${move.to}  ${move.what}  (${move.count} files)`)
  }
  if (plan.keeps.length > 0) {
    lines.push('Left untouched:')
    for (const item of plan.keeps) lines.push(`  · ${item}`)
  }
  if (plan.questions.length > 0) {
    lines.push('Ask the owner:')
    for (const item of plan.questions) lines.push(`  ? ${item}`)
  }
  if (summary.truncated) lines.push('', 'WARNING: the tree was not walked completely — this plan is preliminary.')
  return lines.join('\n')
}

const JOURNAL_CAP = 64_000

export function renderArchivalJournal({ map, summary, facts, plans, root }) {
  const lines = []
  lines.push(`# Archival lab journal · ${basename(root)}`)
  lines.push('')
  lines.push(`Compiled: ${new Date().toISOString().slice(0, 10)} · directories read ${summary.directories}, files ${summary.files}`)
  lines.push('')
  lines.push('Three kinds of statement, kept apart on purpose: **fact** — what a file and')
  lines.push('its path prove; **guess** — a reading of the meaning, marked as such;')
  lines.push('**plan** — what to do with the structure. Guesses do not become facts without a check.')
  lines.push('')
  lines.push('## 1. Map')
  lines.push('')
  lines.push(`See \`${MAP_MD}\` beside this file (the full tree) and \`${TREE_JSON}\` (machine-readable nodes).`)
  lines.push('')
  lines.push(`- directories: ${summary.directories}, files: ${summary.files}, volume: ${formatBytes(summary.bytes)}`)
  lines.push(`- by kind: ${Object.entries(summary.byKind).sort((left, right) => right[1] - left[1]).map(([kind, count]) => `${kind} ${count}`).join(' · ')}`)
  if ((summary.packs ?? []).length > 0) {
    lines.push(`- domain: ${summary.packs.map((hit) => `${hit.id} ${Math.round(hit.share * 100)} % (${hit.evidence.join(', ')})`).join(' · ')}`)
  } else {
    lines.push('- domain not determined: every signature is below 5 %, only the universal role vocabulary applies')
  }
  const roleLine = Object.entries(summary.roles ?? {}).sort((left, right) => right[1] - left[1]).map(([role, count]) => `${role} ${count}`).join(' · ')
  if (roleLine.length > 0) lines.push(`- directory roles: ${roleLine}`)
  if ((summary.sniffed ?? 0) > 0) lines.push(`- recognised from the first bytes (not the extension): ${summary.sniffed} files`)
  const runDirs = map.nodes.filter((node) => node.role === 'run').map((node) => node.path)
  const paperDirs = map.nodes.filter((node) => node.role === 'paper').map((node) => node.path)
  const litDirs = map.nodes.filter((node) => node.role === 'literature').map((node) => node.path)
  if (runDirs.length > 0) lines.push(`- run directories (${runDirs.length}): ${runDirs.slice(0, 8).join(', ')}`)
  if (paperDirs.length > 0) lines.push(`- directories with a paper/draft (${paperDirs.length}): ${paperDirs.slice(0, 8).join(', ')}`)
  if (litDirs.length > 0) lines.push(`- literature (${litDirs.length}): ${litDirs.slice(0, 8).join(', ')}`)
  if (summary.notable.empty.length > 0) lines.push(`- empty directories (${summary.notable.empty.length}): ${summary.notable.empty.slice(0, 8).join(', ')}`)
  if ((summary.unknownNames ?? []).length > 0) {
    lines.push(`- not recognised (top 10): ${summary.unknownNames.slice(0, 10).map((item) => `${item.name} ×${item.count}`).join(' · ')}`)
  }
  lines.push('')
  lines.push('## 2. Facts (proved by files)')
  lines.push('')
  if (facts.length === 0) lines.push('- nothing parsed: the tree holds no files of a known kind')
  for (const fact of facts) lines.push(`- \`${fact.path}\` — ${fact.text}`)
  lines.push('')
  lines.push('## 3. Guesses (readings that need the owner to confirm)')
  lines.push('')
  lines.push('- a directory role comes from the files inside it, not from its name: the name only raises priority')
  lines.push('- a run directory usually means a series of variants; only the owner knows which one is final')
  lines.push('- a directory with a paper usually holds an unfinished manuscript; check the date and whether figures are there')
  lines.push('- an "empty directory" may be a placeholder or a lost result (check the git history)')
  lines.push('- tables and figures without a paper or a journal are the typical "done but never written up" case')
  lines.push('')
  lines.push('## 4. Plan for fitting in')
  lines.push('')
  for (const plan of plans) {
    lines.push(renderPlan(plan, summary))
    lines.push('')
  }
  lines.push('## 5. How to move things (if the third mode is chosen)')
  lines.push('')
  lines.push('1. Snapshot first: `tree.json` already holds the paths; hashes are not needed to put everything back.')
  lines.push('2. Move one directory at a time, with a `decision` in the journal: what, from where, to where and why.')
  lines.push('3. Do not move raw data (`data/raw/**`): it is protected by the guard, work happens on copies.')
  lines.push('4. After every step run `notebook_verify`, so the chain stays intact.')
  lines.push('')
  lines.push('## 6. What to ask the owner')
  lines.push('')
  lines.push('- which directory is current work (it enters the index first)')
  lines.push('- what is already published and must not move')
  lines.push('- where the raw data is that must not be touched')
  lines.push('- whether there are results that "did not work out" and must be kept as they are')
  lines.push('- which directories from the "left untouched" list are actually archive')
  const text = lines.join('\n')
  if (text.length <= JOURNAL_CAP) return text
  const cut = text.slice(0, JOURNAL_CAP)
  const lastBreak = cut.lastIndexOf('\n')
  return `${cut.slice(0, lastBreak)}\n\n… the journal was trimmed to the ${Math.round(JOURNAL_CAP / 1000)} KB budget: full lists are in map.md and tree.json, the sizes of the plans are in plan-*.json`
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

const AGENTS_POINTER = `# Instructions for this directory

This is an existing research project. Its structure took shape before the harness
was connected and is **not restructured without the owner's decision**.

The project map and the archival journal live in \`.dsh/map/\`:

- \`.dsh/map/map.md\` — what sits where (tree, file kinds, sizes);
- \`.dsh/map/tree.json\` — the same nodes for tools;
- \`.dsh/map/archival-journal.md\` — facts, guesses and the plan for fitting in.

Rules for working in this directory:

1. Before reading the tree by hand, look at the map — it is already built.
2. Do not rename or move files without the owner's explicit permission.
3. Read raw data, do the work on copies; the protected paths are in \`.dsh/policy.json\`.
4. Everything computed is computed by a script; everything claimed is backed by a path.
`

const POLICY = {
  protectedPaths: ['data/raw/**', 'data/**', '**/raw/**'],
  destructiveConfirm: true,
}

export async function adoptProject(workspace, { root, mode = 'light', markers = false, apply = false, maxFiles = 20000, maxDepth = 6, markerName = '.dsh-map.json' } = {}) {
  const target = resolve(root ?? workspace)
  const zone = resolve(workspace)
  if (target !== zone && !target.startsWith(zone.endsWith(sep) ? zone : `${zone}${sep}`)) {
    return {
      ok: false,
      error: `root ${target} is outside the workspace ${zone}: adoption only ever writes inside the project you work in`,
      target,
    }
  }
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
    const index = ['# Index: what this directory already holds', '', 'Created while fitting in. No files were moved.', '']
    for (const [kind, count] of Object.entries(summary.byKind).sort((left, right) => right[1] - left[1])) {
      index.push(`## ${kind} (${count})`)
      const examples = map.nodes.flatMap((node) => node.samples.filter((sample) => kindOf(sample) === kind).map((sample) => toPosix(join(node.path === '.' ? '' : node.path, sample)))).slice(0, 12)
      for (const example of examples) index.push(`- \`${example}\``)
      index.push('')
    }
    if (await attempt(result.skipped, 'literature/_INDEX.md', async () => {
      const state = await ensureFile(join(target, 'literature', '_INDEX.md'), index.join('\n') + '\n')
      result[state === 'created' ? 'created' : 'kept'].push('literature/_INDEX.md')
    }) === false) {
      /* a read-only literature directory keeps no index, and the report says so */
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
      const workspace = await activeWorkspace(ctx, exec, config)
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
      const factsText = ['', '## Facts', '', ...facts.map((fact) => `- \`${fact.path}\` — ${fact.text}`)].join('\n')
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
      const workspace = await activeWorkspace(ctx, exec, config)
      const mode = ['as-is', 'light', 'restructure'].includes(args?.mode) ? args.mode : 'light'
      const result = await adoptProject(workspace, {
        root: typeof args?.path === 'string' && args.path.length > 0 ? resolve(workspace, args.path) : workspace,
        mode,
        markers: args?.markers === true,
        apply: args?.apply === true,
        maxFiles: typeof args?.max_files === 'number' ? args.max_files : 20000,
        maxDepth: typeof args?.max_depth === 'number' ? args.max_depth : 6,
      })
      if (result.ok === false) return { ok: false, error: result.error, target: result.target, text: `project_adopt: refused — ${result.error}` }
      const lines = []
      lines.push(`Project: ${result.target}`)
      lines.push(`Directories ${result.summary.directories} · files ${result.summary.files}` +
        `${result.summary.truncated ? ' · the walk stopped at the limit' : ''}` +
        `${(result.summary.packs ?? []).length > 0 ? ` · domain: ${result.summary.packs.map((hit) => `${hit.id} ${Math.round(hit.share * 100)} %`).join(', ')}` : ' · domain not determined'}`)
      lines.push('')
      lines.push(result.planText)
      lines.push('')
      lines.push('## Three modes (choose with the owner)')
      for (const plan of result.plans) {
        const title = { 'as-is': 'as is', light: 'light', restructure: 'restructure' }[plan.mode]
        lines.push(`- **${title}** — creates ${plan.creates.length}, moves ${plan.moves.length === 0 ? 'nothing' : `${plan.moves.length} groups of files (on confirmation)`}`)
      }
      if (result.skipped.length > 0) {
        lines.push('')
        lines.push('Could not write (directory outside the write zone or forbidden):')
        for (const item of result.skipped) lines.push(`  ! ${item.path} — ${item.reason}`)
        lines.push('  The map and the journal went to the session working folder; AGENTS.md and the standard')
        lines.push('  folders in the project itself are created by the owner or by a step with danger-full-access.')
      }
      if (result.created.length > 0) {
        lines.push('')
        lines.push('Written:')
        for (const item of result.created) lines.push(`  + ${item}`)
        if (result.kept.length > 0) for (const item of result.kept) lines.push(`  = ${item} (already there, not overwritten)`)
      } else {
        lines.push('')
        lines.push('Nothing written: this is a plan. Repeat with apply=true to create the map, the archival journal and (for light/restructure) the standard folders.')
      }
      return { target: result.target, mode, summary: result.summary, text: lines.join('\n'), created: result.created, facts: result.facts }
    },
  })
}

export default { name, inject, apply }
