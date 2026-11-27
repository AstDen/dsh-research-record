/**
 * Domain-neutral classification: file kinds, directory roles, domain packs.
 *
 * The mistake this module exists to prevent: teaching the classifier one field's
 * conventions (OpenFOAM time directories) and calling it "science". Everything
 * here is split in two:
 *
 * - **universal** — magic bytes, text sniffing, the role vocabulary, the rules
 *   that turn a set of files into a role. One implementation for all domains.
 * - **domain data** — `packs/*.json`. A pack adds extensions, name hints, field
 *   names, directory signatures and wording. A colleague drops their own pack
 *   into `<project>/.dsh/packs/` and the same code understands their tree.
 *
 * Detection is additive and reported: a project can match three packs at once,
 * and "domain not recognised" is a valid answer that falls back to the universal
 * vocabulary instead of guessing.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
export const PACKS_DIR = join(MODULE_DIR, 'packs')

/** Universal role vocabulary. Domain packs may rename, never extend it silently. */
export const ROLES = ['run', 'raw-data', 'derived', 'analysis', 'paper', 'literature', 'talks', 'admin', 'archive', 'empty', 'mixed']

/** Precedence when two roles score the same: the more specific one wins. */
const ROLE_ORDER = ['run', 'raw-data', 'analysis', 'paper', 'literature', 'talks', 'admin', 'archive', 'derived', 'empty', 'mixed']

const MAGIC = [
  { bytes: Buffer.from('%PDF-'), kind: 'pdf' },
  { bytes: Buffer.from([0x89, 0x48, 0x44, 0x46]), kind: 'binary' }, // HDF5
  { bytes: Buffer.from([0x89, 0x43, 0x47, 0x4e, 0x53]), kind: 'mesh' }, // CGNS
  { bytes: Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]), kind: 'binary' }, // .npy
  { bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]), kind: 'archive' }, // zip family
  { bytes: Buffer.from([0x1f, 0x8b]), kind: 'archive' },
  { bytes: Buffer.from([0x49, 0x49, 0x2a, 0x00]), kind: 'image' }, // TIFF LE
  { bytes: Buffer.from([0x4d, 0x4d, 0x00, 0x2a]), kind: 'image' }, // TIFF BE
  { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]), kind: 'image' }, // PNG
  { bytes: Buffer.from([0xff, 0xd8, 0xff]), kind: 'image' }, // JPEG
  { bytes: Buffer.from('MATLAB 5.0 MAT-file'), kind: 'binary' },
]

/**
 * What the first bytes say. Extension-free files are exactly the case that
 * breaks a name-based classifier, so this runs before any extension lookup.
 */
export function sniffBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null
  for (const entry of MAGIC) {
    if (buffer.length >= entry.bytes.length && buffer.subarray(0, entry.bytes.length).equals(entry.bytes)) {
      return entry.kind
    }
  }
  const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8')
  if (/^\s*FoamFile\b/m.test(head)) return 'dict'
  if (/^\/\*-{6,}\s*C\+\+/.test(head)) return 'dict'
  // A dictionary: `key value;` lines, optional nested braces, no column separators.
  if (/^[A-Za-z_][\w.]*\s+[^;{}\n]*;/m.test(head) && !/,[^\n]*,[^\n]*,/.test(head)) return 'dict'
  // A table: two consecutive lines with the same non-zero separator count.
  const lines = head.split('\n').filter((line) => line.trim().length > 0).slice(0, 4)
  if (lines.length >= 2) {
    for (const separator of [',', ';', '\t', '|']) {
      const counts = lines.map((line) => line.split(separator).length - 1)
      if (counts[0] >= 1 && counts.every((count) => count === counts[0])) return 'table'
    }
  }
  if (/^\s*\w+\s*=\s*\S/m.test(head)) return 'config'
  if (/^[\x09\x0a\x0d\x20-\x7e\u0400-\u04ff]*$/.test(head)) return 'text'
  return null
}

function safeRegExp(pattern) {
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

function normalisePack(raw, source) {
  if (raw === null || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null
  if (id === null) return null
  const extensions = {}
  for (const [extension, kind] of Object.entries(raw?.kinds?.extensions ?? {})) {
    if (typeof extension === 'string' && typeof kind === 'string') extensions[extension.toLowerCase().replace(/^\./, '')] = kind
  }
  const names = {}
  for (const [name, kind] of Object.entries(raw?.kinds?.names ?? {})) {
    if (typeof name === 'string' && typeof kind === 'string') names[name] = kind
  }
  return {
    id,
    title: typeof raw.title === 'string' ? raw.title : id,
    source,
    extensions,
    names,
    fieldNames: new Set(Array.isArray(raw?.kinds?.fieldNames) ? raw.kinds.fieldNames.map(String) : []),
    // Species and extra fields are open-ended: a pattern beats a list that goes
    // stale the moment a mechanism is swapped for another.
    fieldPattern: typeof raw?.kinds?.fieldPattern === 'string' && raw.kinds.fieldPattern.length > 0
      ? safeRegExp(raw.kinds.fieldPattern)
      : null,
    dirs: Array.isArray(raw.dirs) ? raw.dirs.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.role === 'string') : [],
    match: {
      files: Array.isArray(raw?.match?.files) ? raw.match.files.map(String) : [],
      names: Array.isArray(raw?.match?.names) ? raw.match.names.map(String) : [],
      extensions: raw?.match?.extensions !== null && typeof raw?.match?.extensions === 'object' ? raw.match.extensions : {},
    },
    wording: raw?.wording !== null && typeof raw?.wording === 'object' ? raw.wording : {},
  }
}

function readPackFile(path, source) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return normalisePack(parsed, source)
  } catch {
    return null
  }
}

function readPackDirectory(directory, source) {
  let entries = []
  try {
    entries = readdirSync(directory)
  } catch {
    return []
  }
  const packs = []
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.json')) continue
    const pack = readPackFile(join(directory, entry), source)
    if (pack !== null) packs.push(pack)
  }
  return packs
}

/**
 * Built-in packs plus the packs a colleague added to the project.
 *
 * A project-level pack overrides a built-in pack with the same id: the owner of
 * the tree knows their instrument better than this bundle does.
 */
export function loadPacks(root) {
  const builtin = readPackDirectory(PACKS_DIR, 'builtin')
  const local = typeof root === 'string' && root.length > 0 ? readPackDirectory(join(root, '.dsh', 'packs'), 'project') : []
  const byId = new Map()
  for (const pack of [...builtin, ...local]) byId.set(pack.id, pack)
  return [...byId.values()]
}

/** Extension → kind, with packs overriding the universal table. */
export function mergeExtensions(baseKinds, packs) {
  const map = new Map()
  for (const [kind, extensions] of Object.entries(baseKinds)) {
    for (const extension of extensions) map.set(extension, kind)
  }
  for (const pack of packs) {
    for (const [extension, kind] of Object.entries(pack.extensions)) map.set(extension, kind)
  }
  return map
}

function globToRegExp(pattern) {
  const source = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*')
  return new RegExp(`^${source}$`)
}

function pathMatches(relativePath, patterns) {
  if (patterns.length === 0) return false
  return patterns.some((pattern) => globToRegExp(pattern).test(relativePath))
}

/**
 * Which domains does this tree look like?
 *
 * Shares, not a verdict: `numeric-openfoam 74%, experiment 9%` is the honest
 * answer for a project that is mostly CFD with a few measurement tables. Below
 * `threshold` nothing is reported and the caller keeps the universal vocabulary.
 */
export function detectPacks(map, packs = [], { threshold = 0.05 } = {}) {
  const total = Math.max(1, map.nodes.reduce((sum, node) => sum + node.files, 0))
  const results = []
  for (const pack of packs) {
    const evidence = []
    let files = 0
    const byName = new Map()
    const byExtension = new Map()
    for (const node of map.nodes) {
      for (const name of node.names ?? []) {
        const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
        const wanted = extension.length > 0 ? pack.extensions[extension] : undefined
        if (wanted !== undefined) {
          files += 1
          byExtension.set(extension, (byExtension.get(extension) ?? 0) + 1)
          continue
        }
        if (pack.names[name] !== undefined || pack.fieldNames.has(name)) {
          files += 1
          byName.set(name, (byName.get(name) ?? 0) + 1)
        }
      }
    }
    for (const [extension, count] of [...byExtension.entries()].sort((left, right) => right[1] - left[1]).slice(0, 2)) {
      evidence.push(`.${extension} ×${count}`)
    }
    for (const [name, count] of [...byName.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3)) {
      evidence.push(`${name} ×${count}`)
    }
    for (const node of map.nodes) {
      if (pathMatches(node.path === '.' ? '' : node.path, pack.match.files)) {
        files += 1
        evidence.push(`${node.path}/`)
        break
      }
    }
    for (const [extension, minimum] of Object.entries(pack.match.extensions)) {
      const count = byExtension.get(extension) ?? 0
      if (count >= Number(minimum)) evidence.push(`.${extension} ≥${minimum}`)
    }
    const share = files / total
    if (share >= threshold) results.push({ id: pack.id, title: pack.title, share, files, evidence: [...new Set(evidence)].slice(0, 4) })
  }
  return results.sort((left, right) => right.share - left.share)
}

/** Wording from the dominant pack: "расчёт" for CFD, "измерение" for an experiment. */
export function wordingOf(packs, detected) {
  const wording = {}
  for (const hit of detected) {
    const pack = packs.find((candidate) => candidate.id === hit.id)
    if (pack === undefined) continue
    for (const [role, word] of Object.entries(pack.wording)) {
      if (wording[role] === undefined) wording[role] = word
    }
  }
  return wording
}

function kindsOf(node) {
  const kinds = node.kinds ?? {}
  return {
    get: (kind) => kinds[kind] ?? 0,
    has: (kind) => (kinds[kind] ?? 0) > 0,
    total: node.files,
  }
}

/**
 * Score the universal roles from evidence only.
 *
 * Every branch returns a reason, and the reason ends up in the map: a reader can
 * check why a directory was called a run instead of trusting a label.
 */
function scoreRoles(node, context) {
  const kinds = kindsOf(node)
  const scores = []
  const add = (role, score, reason) => scores.push({ role, score, reason })
  const names = node.names ?? []
  const hasExtension = (list) => names.some((name) => list.some((extension) => name.toLowerCase().endsWith(`.${extension}`)))

  if (kinds.total === 0 && (node.subtreeFiles ?? 0) === 0) add('empty', 2, 'нет файлов ни в этом каталоге, ни ниже')

  if (context.packRole !== undefined) add(context.packRole, 6, context.packReason ?? 'сигнатура пака')

  const resultEvidence = kinds.has('log') || kinds.has('table') || kinds.has('field') || kinds.has('post') || (kinds.has('binary') && kinds.has('dict'))
  const configEvidence = kinds.has('dict') || kinds.has('config') || kinds.has('case') || kinds.has('mesh') || hasExtension(['in', 'inp', 'setting', 'settings'])
  if (resultEvidence && configEvidence) add('run', 5, 'есть входные параметры и результат')
  else if (resultEvidence && kinds.has('log')) add('run', 3, 'есть лог выполнения')
  else if (kinds.has('case') && kinds.has('field')) add('run', 4, 'расчётный каталог с полями')

  if (kinds.has('bib') || (kinds.has('pdf') && !kinds.has('table') && !kinds.has('code'))) {
    add('literature', kinds.has('bib') === true && kinds.has('pdf') === true ? 4 : 3, 'библиография и/или подборка PDF без данных')
  }
  if (kinds.has('tex') && (kinds.has('pdf') || kinds.has('image') || /paper|article|draft|статья|рукопись/i.test(node.path))) {
    add('paper', 4, 'LaTeX и вложенные рисунки/PDF')
  } else if (kinds.has('tex')) {
    add('paper', 2, 'только LaTeX-исходник')
  }
  if (hasExtension(['pptx', 'ppt', 'odp', 'key'])) add('talks', 3, 'презентации')
  if ((kinds.has('code') || kinds.has('notebook')) && (kinds.has('table') || kinds.has('image') || kinds.has('field'))) {
    add('analysis', 3, 'код/ноутбук рядом с таблицами или рисунками')
  } else if (kinds.has('code') || kinds.has('notebook')) {
    add('analysis', 2, 'только код')
  }
  if ((kinds.has('image') || kinds.has('binary')) && !kinds.has('code') && !kinds.has('tex') && !kinds.has('dict')) {
    add('raw-data', 2, 'только исходные снимки/двоичные данные')
  }
  if (/raw|исходн|первичн/i.test(node.path) && kinds.total > 0) add('raw-data', 2, 'каталог назван как исходные данные')
  if (/derived|processed|filtered|cropped|обработ|производн/i.test(node.path) && kinds.total > 0) add('derived', 2, 'каталог назван как производные данные')
  if (/admin|документ|счет|счёт|договор|акт|grant|invoice/i.test(node.path) && (kinds.has('document') || kinds.has('pdf'))) {
    add('admin', 3, 'документы, а не данные')
  }
  if (kinds.has('archive') && kinds.has('archive') >= Math.max(1, kinds.total - 1)) add('archive', 3, 'почти только архивы')

  const best = scores.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    return ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role)
  })[0]
  return best
}

/**
 * Assign a role to every directory and repair extension-free names.
 *
 * `patchKinds` is the second half of the OpenFOAM fix and works for any
 * dictionary-driven code: a file named `p` inside a case directory is a field,
 * the same name in `src/` stays `other` and is reported as unknown.
 */
export function assignRoles(map, packs = []) {
  const byPath = new Map(map.nodes.map((node) => [node.path, node]))
  const childrenOf = new Map()
  for (const node of map.nodes) {
    const parent = node.path === '.' ? undefined : node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '.'
    if (parent === undefined) continue
    if (!childrenOf.has(parent)) childrenOf.set(parent, [])
    childrenOf.get(parent).push(node)
  }
  for (const node of map.nodes) node.subtreeFiles = node.files
  for (const node of map.nodes) {
    let path = node.path
    while (path !== '.') {
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.'
      const target = byPath.get(parent)
      if (target !== undefined) target.subtreeFiles = (target.subtreeFiles ?? 0) + node.files
      path = parent
    }
  }
  const patched = []
  for (const node of map.nodes) {
    if (node.files === 0) continue
    for (const pack of packs) {
      const names = new Map()
      for (const [name, count] of Object.entries(node.otherCounts ?? {})) {
        const kind = pack.names[name] ?? (pack.fieldNames.has(name) ? 'field' : undefined)
        if (kind === undefined) continue
        names.set(kind, (names.get(kind) ?? 0) + count)
        delete node.otherCounts[name]
        node.otherNames = (node.otherNames ?? []).filter((item) => item !== name)
      }
      if (names.size === 0) continue
      for (const [kind, count] of names) {
        const previous = node.kinds.other ?? 0
        const moved = Math.min(previous, count)
        if (moved === 0) break
        node.kinds.other = previous - moved
        if ((node.kinds.other ?? 0) === 0) delete node.kinds.other
        node.kinds[kind] = (node.kinds[kind] ?? 0) + moved
        patched.push({ path: node.path, kind, count: moved, pack: pack.id })
      }
    }
  }
  const roles = {}
  for (const node of map.nodes) {
    let packRole
    let packReason
    for (const pack of packs) {
      for (const signature of pack.dirs) {
        const nameMatches = typeof signature.nameMatches === 'string' ? new RegExp(signature.nameMatches) : null
        const base = node.path === '.' ? '' : node.path.slice(node.path.lastIndexOf('/') + 1)
        if (nameMatches !== null && !nameMatches.test(base)) continue
        if (Array.isArray(signature.parentHas)) {
          const parent = node.path === '.' ? undefined : byPath.get(node.path.slice(0, node.path.lastIndexOf('/')) === '' ? '.' : node.path.slice(0, node.path.lastIndexOf('/')))
          const parentNames = new Set(parent?.names ?? [])
          if (!signature.parentHas.some((needed) => parentNames.has(needed))) continue
        }
        if (Array.isArray(signature.hasFiles) && !signature.hasFiles.some((needed) => (node.names ?? []).includes(needed))) continue
        // "Looks like a field directory" is settled by its contents, not by the
        // name of its parent: a case may nest time directories two levels down.
        if (typeof signature.minExtensionless === 'number') {
          const extensionless = Object.keys(node.otherCounts ?? {}).filter((name) => !name.includes('.')).length
          if (extensionless < signature.minExtensionless) continue
        }
        packRole = signature.role
        packReason = `пак ${pack.id}: ${signature.id ?? signature.role}`
        node.excludeFromNotable = signature.excludeFromNotable === true
        if (signature.fieldFiles === true) node.fieldFiles = true
        break
      }
      if (packRole !== undefined) break
    }
    const best = scoreRoles(node, { packRole, packReason })
    node.role = best?.role ?? ((node.subtreeFiles ?? 0) === 0 ? 'empty' : 'mixed')
    node.roleReason = best?.reason ?? 'нет характерных признаков'
    roles[node.role] = (roles[node.role] ?? 0) + 1
  }
  // A directory without files is what its children are: `runs/` holding only
  // `runs/case_a/` is a run directory, not an empty one.
  for (const node of map.nodes) {
    if (node.files > 0 || node.role !== 'mixed') continue
    const counts = new Map()
    for (const child of childrenOf.get(node.path) ?? []) {
      if (child.role === undefined || child.role === 'empty') continue
      counts.set(child.role, (counts.get(child.role) ?? 0) + 1)
    }
    const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]
    if (top !== undefined) {
      node.role = top[0]
      node.roleReason = `как дочерние каталоги (${top[0]})`
    }
  }
  for (const node of map.nodes) {
    if (node.role === undefined) continue
    if ((node.subtreeFiles ?? 0) === 0 && node.files === 0) node.role = 'empty'
  }
  // Species and user fields inside a recognised field directory: the name list
  // in the pack cannot cover every mechanism, so a pattern finishes the job.
  for (const node of map.nodes) {
    if (node.fieldFiles !== true) continue
    for (const pack of packs) {
      if (pack.fieldPattern === null) continue
      let moved = 0
      for (const [name, count] of Object.entries(node.otherCounts ?? {})) {
        if (name.includes('.')) continue
        if (!pack.fieldPattern.test(name)) continue
        moved += count
        delete node.otherCounts[name]
        node.otherNames = (node.otherNames ?? []).filter((item) => item !== name)
      }
      if (moved === 0) continue
      node.kinds.other = (node.kinds.other ?? 0) - moved
      if ((node.kinds.other ?? 0) <= 0) delete node.kinds.other
      node.kinds.field = (node.kinds.field ?? 0) + moved
      patched.push({ path: node.path, kind: 'field', count: moved, pack: pack.id })
    }
  }
  const unknown = unknownNames(map)
  map.packs = detectPacks(map, packs)
  map.wording = wordingOf(packs, map.packs)
  map.roles = roles
  map.unknownNames = unknown
  return { roles, unknown, patched }
}

/** Names the classifier could not place — the feedback loop for a new domain. */
export function unknownNames(map, limit = 20) {
  const counts = new Map()
  for (const node of map.nodes) {
    for (const [name, count] of Object.entries(node.otherCounts ?? {})) {
      counts.set(name, (counts.get(name) ?? 0) + count)
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }))
}

/**
 * Which canonical directories are justified by the roles that exist.
 *
 * This is the "universal but specific" part: a literature-only project gets no
 * `runs/`, an experiment gets `data/raw` and `runs/`, a CFD case gets everything.
 */
export function skeletonForRoles(roles, wording = {}) {
  const present = (role) => (roles[role] ?? 0) > 0
  const directories = []
  const add = (path, reason) => directories.push({ path, reason })
  add('paper', 'у статьи есть автор всегда')
  add('admin', 'документы проекта (гранты, отчёты, счета) не данные')
  if (present('run') || present('raw-data') || present('derived')) {
    add('data/raw', 'исходные данные неприкосновенны')
    add('data/derived', 'производные данные отдельно от исходных')
  }
  if (present('run')) {
    add('runs', `${wording.run ?? 'прогоны'} — по каталогу на вариант`)
    add('runs/logs', 'логи рядом с прогонами')
  }
  if (present('run') && (roles.mesh ?? 0) >= 0) add('models', 'сетки и конфигурации отдельно от результатов')
  if (present('analysis') || present('run') || present('derived')) {
    add('analysis/scripts', 'код, который считает')
    add('analysis/figures', 'рисунки, которые генерируются скриптом')
    add('analysis/tables', 'таблицы, которые генерируются скриптом')
  }
  if (present('literature')) {
    add('literature/refs', 'PDF и .bib')
    add('literature/notes', 'карточки прочитанного')
  }
  if (present('talks')) add('talks', 'презентации и доклады')
  add('hypotheses', 'гипотезы должны быть записаны до прогона')
  return directories
}
