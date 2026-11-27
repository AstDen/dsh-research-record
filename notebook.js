/**
 * dsh-research-record — notebook: an append-only, hash-chained lab journal.
 *
 * One journal per session: `<workspace>/.dsh/notebook/<sessionId>.jsonl`.
 * Every line is one record with `prevHash` pointing at the previous line and
 * `hash` = sha256 over the canonical JSON of the record without `hash`, so a
 * single edited character breaks the chain and `notebook_verify` says where.
 *
 * Records are never edited. A correction is a new record with `supersedes:
 * "<old id>"`; the link is appended to `.dsh/notebook/supersede.jsonl`, and
 * readers project `supersededBy` from it (the old line itself stays untouched
 * — a rewrite would break the chain).
 *
 * The gates are server-side, never model-side:
 *   - a `hypothesis` needs a title;
 *   - `outcome` exists only for `observation` and `hypothesis`;
 *   - `execution.state=completed` without `execution.evidence` is downgraded
 *     to `unverified` and reported in `warnings`;
 *   - every `artifacts[].path` is hashed now and re-checked on read
 *     (`unchanged` / `changed` / `missing`);
 *   - `evidence[].entryId`, `supersedes` and `relatesTo` pointing at unknown
 *     entries are dropped with a warning.
 */

import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { appendFile, copyFile, mkdir, open, readdir, readFile, stat, truncate } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { appendLine, withAppendLock } from './lock.js'
import { getService } from './services.js'

export const name = 'research-record-notebook'
export const inject = ['tools', 'systemPrompt']

const SCHEMA_VERSION = 1
const GENESIS = '0'.repeat(64)
const NOTEBOOK_DIR = '.dsh/notebook'
const SUPERSEDE_FILE = 'supersede.jsonl'
const TYPE_SET = new Set(['hypothesis', 'method', 'observation', 'decision', 'note'])
const OUTCOME_SET = new Set(['signal', 'null', 'inconclusive', 'technical-failure'])
const OUTCOME_TYPES = new Set(['observation', 'hypothesis'])
const STATE_SET = new Set(['planned', 'attempted', 'completed', 'unverified'])
const RELATION_SET = new Set(['supports', 'challenges', 'inconclusive', 'context'])
const CONFIDENCE_SET = new Set(['low', 'medium', 'high'])
/** A record is a research note, not a file dump: 512 KiB is already generous. */
const MAX_INPUT_BYTES = 512 * 1024

/** Crockford base32 — ULID, monotone enough for a journal. */
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function ulid(now = Date.now()) {
  let time = Math.floor(now)
  const timePart = new Array(10)
  for (let index = 9; index >= 0; index -= 1) {
    timePart[index] = ULID_ALPHABET[time % 32]
    time = Math.floor(time / 32)
  }
  const bytes = randomBytes(16)
  const randomPart = new Array(16)
  for (let index = 0; index < 16; index += 1) randomPart[index] = ULID_ALPHABET[bytes[index] % 32]
  return `${timePart.join('')}${randomPart.join('')}`
}

/** Stable stringify: sorted keys, no whitespace. The hash input. */
export function canonicalJson(value) {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const keys = Object.keys(value).sort()
  const parts = []
  for (const key of keys) {
    if (value[key] === undefined) continue
    parts.push(`${JSON.stringify(key)}:${canonicalJson(value[key])}`)
  }
  return `{${parts.join(',')}}`
}

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex')
}

/** sha256 of a file, streamed (artifacts can be hundreds of MB). */
export async function sha256File(path) {
  const hash = createHash('sha256')
  await new Promise((accept, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', accept)
  })
  return hash.digest('hex')
}

/** Hash one record without its own `hash` field. */
export function hashRecord(record) {
  const { hash: _ignored, ...rest } = record
  return sha256Hex(canonicalJson(rest))
}

function safeSessionId(value) {
  const text = String(value ?? 'global')
  return text.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'global'
}

/**
 * Where the project record lives, and how that was decided.
 *
 * The chain is deliberately explicit, because every silent fallback in it writes
 * a journal into the wrong directory: a record that lands in
 * `node_modules/.bin/.dsh/notebook` looks written — the tool prints a hash — and
 * is lost the moment the launcher updates. Sources, in order:
 *
 * 1. `workingDirectory.ensure(agent)` — the harness validates and restores it,
 *    the same path the built-in fs/bash tools take;
 * 2. the durable session header (`cwd` at session creation);
 * 3. `config.workspace` of this bundle (a profile-level default);
 * 4. `DSH_RESEARCH_WORKSPACE`;
 * 5. `process.cwd()` — last resort, reported as `source: 'process'`.
 *
 * A directory inside `node_modules` is refused unless it came from an explicit
 * configuration: that is the launcher's own tree, never a research project.
 */
export async function resolveWorkspace(ctx, exec, config) {
  const agentId = exec?.agent?.id
  let cwd
  let source = 'process'

  // 1. The harness owns the answer.
  try {
    const service = getService(ctx, 'workingDirectory')
    if (exec?.agent !== undefined && typeof service?.ensure === 'function') {
      const resolved = await service.ensure(exec.agent, exec.signal)
      if (typeof resolved === 'string' && resolved.length > 0) {
        cwd = resolved
        source = 'workingDirectory'
      }
    }
  } catch {
    /* fall through to the session header */
  }

  // 2. The session header keeps the original project directory.
  if (cwd === undefined) {
    try {
      const store = getService(ctx, 'sessions')
      const session = agentId === undefined ? undefined : store?.get?.(agentId)
      const headerCwd = session?.header?.cwd
      if (typeof headerCwd === 'string' && headerCwd.length > 0) {
        cwd = headerCwd
        source = 'session'
      }
    } catch {
      /* no session store */
    }
  }

  // 3. A profile-level default for this bundle.
  if (cwd === undefined && typeof config?.workspace === 'string' && config.workspace.length > 0) {
    cwd = config.workspace
    source = 'config'
  }

  // 4. An environment override, for a process whose session header is missing.
  if (cwd === undefined && typeof process.env.DSH_RESEARCH_WORKSPACE === 'string' && process.env.DSH_RESEARCH_WORKSPACE.length > 0) {
    cwd = process.env.DSH_RESEARCH_WORKSPACE
    source = 'env'
  }

  // 5. Last resort.
  if (cwd === undefined) cwd = process.cwd()

  const explicit = source === 'config' || source === 'env'
  if (!explicit && /[\\/]node_modules[\\/]/.test(cwd)) {
    throw new Error(
      `research record: the project directory resolved to ${cwd}, which is the launcher's own tree. ` +
        'Writing a journal there loses it on the next update. ' +
        'Set `workspace` in the bundle configuration, or DSH_RESEARCH_WORKSPACE, to the project directory.',
    )
  }

  return { cwd, source }
}

/** Exported for the scaffold module: one workspace resolution for the whole bundle. */
export async function activeWorkspace(ctx, exec, config) {
  const { cwd } = await resolveWorkspace(ctx, exec, config)
  return cwd
}

/**
 * The web panel is a reader for one project, not for the whole disk: the
 * requested directory must be the workspace of a live session of this host (or
 * the host's own directory). `?workspace=/etc` is refused instead of listed.
 */
export async function panelWorkspace(ctx, requested) {
  const raw = typeof requested === 'string' && requested.length > 0 ? requested : process.cwd()
  const target = isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw)
  const known = new Set([resolve(process.cwd())])
  try {
    const store = getService(ctx, 'sessions')
    for (const session of store?.list?.() ?? []) {
      const cwd = session?.header?.cwd
      if (typeof cwd === 'string' && cwd.length > 0) known.add(resolve(cwd))
    }
  } catch {
    /* no session store: only the host directory is trusted */
  }
  if (known.has(target)) return { ok: true, workspace: target }
  return {
    ok: false,
    workspace: target,
    error: `workspace ${target} is not a session workspace of this host; refusing to read its journals`,
  }
}

/**
 * The agent a prompt assembly belongs to.
 *
 * `assembleContextFor` (`dsh-agent/lib/types/dispatch.js:92`) puts the same agent
 * object in two fields — `scope` (what the registry routes by) and `agent` — so
 * either identifies the session. Nothing else in the assembly context names it,
 * and a section that ignores it renders one project's journal inside another.
 */
function scopeSubject(context) {
  const raw = context?.agent ?? context?.scope
  return raw !== undefined && typeof raw?.id === 'string' ? raw : undefined
}

/**
 * Project directory of a session, synchronously.
 *
 * Prompt assembly cannot await `workingDirectory.ensure`, so this reads the
 * durable session header — the same value `activeWorkspace` falls back to. It is
 * the directory the session was created in, which is what the model reasons
 * about, not a later `cd`.
 */
export function sessionWorkspace(ctx, agentId) {
  if (agentId === undefined) return undefined
  try {
    const store = getService(ctx, 'sessions')
    const cwd = store?.get?.(agentId)?.header?.cwd
    if (typeof cwd === 'string' && cwd.length > 0) return cwd
  } catch {
    /* no session store: the caller decides the fallback */
  }
  return undefined
}

async function readLines(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const lines = []
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    lines.push(trimmed)
  }
  return lines
}

/**
 * A journal whose last line is not terminated cannot accept another line: the
 * next append would glue itself to the fragment and lose both records.
 */
class TornJournalError extends Error {
  constructor(file, size) {
    super(
      `journal tail is truncated: ${file} ends at byte ${size} without a newline. ` +
        'Run notebook_verify with repair:true to trim the fragment and keep the intact prefix.',
    )
    this.code = 'TORN_TAIL'
    this.file = file
    this.size = size
  }
}

/** Does the file end on a line boundary? An empty or missing file always does. */
async function journalTail(file) {
  let info
  try {
    info = await stat(file)
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, size: 0, broken: false }
    throw error
  }
  if (info.size === 0) return { exists: true, size: 0, broken: false }
  const handle = await open(file, 'r')
  try {
    const last = Buffer.alloc(1)
    await handle.read(last, 0, 1, info.size - 1)
    return { exists: true, size: info.size, broken: last[0] !== 0x0a }
  } finally {
    await handle.close()
  }
}

/**
 * Append one record under the journal lock, reading the previous hash inside the
 * same critical section. Reading `prevHash` outside the lock is what let two
 * writers fork the chain.
 *
 * @param {string} file journal path
 * @param {object} template record body without `prevHash`/`hash`
 * @param {string[]} [warnings] collected warnings
 * @returns {Promise<object>} the stored record
 */
async function appendRecordOnce(file, template, warnings = []) {
  return withAppendLock(file, async () => {
    const tail = await journalTail(file)
    if (tail.broken) throw new TornJournalError(file, tail.size)
    let prevHash = GENESIS
    const existing = await readLines(file)
    if (existing.length > 0) {
      try {
        const last = JSON.parse(existing[existing.length - 1])
        if (typeof last?.hash === 'string') prevHash = last.hash
      } catch {
        warnings.push('previous line of this journal is unreadable; the chain continues from genesis')
      }
    }
    const record = { ...template, prevHash }
    record.hash = hashRecord(record)
    // The lock is already held, so append with appendFile directly. Going through
    // appendLine would re-acquire the same lock, wait out its retries and then fall
    // back to writing unlocked (see lock.js) — which is what corrupted the chain.
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
    return record
  })
}

/** All journal entries of a workspace, in write order. */
async function projectEntries(workspace) {
  const dir = join(workspace, NOTEBOOK_DIR)
  let names
  try {
    names = await readdir(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') return { entries: [], files: [], dir }
    throw error
  }
  const files = names.filter((entry) => entry.endsWith('.jsonl') && entry !== SUPERSEDE_FILE).sort()
  const entries = []
  for (const fileName of files) {
    let number = 0
    for (const line of await readLines(join(dir, fileName))) {
      number += 1
      try {
        const record = JSON.parse(line)
        entries.push({ record, file: fileName, line: number, raw: line })
      } catch {
        entries.push({ record: null, file: fileName, line: number, raw: line, corrupt: true })
      }
    }
  }
  return { entries, files, dir }
}

/** sessionId -> { targetId, byId, at } from the supersede ledger. */
async function supersedeMap(workspace) {
  const map = new Map()
  for (const line of await readLines(join(workspace, NOTEBOOK_DIR, SUPERSEDE_FILE))) {
    try {
      const link = JSON.parse(line)
      if (typeof link?.targetId === 'string' && typeof link?.byId === 'string') map.set(link.targetId, link)
    } catch {
      /* a torn ledger line is ignored, the record itself is still intact */
    }
  }
  return map
}

/**
 * Walk every journal (or one) and recompute the chain. Shared by the
 * notebook_verify tool and the web panel so both report the same verdict.
 */
async function verifyJournal(workspace, onlyFile) {
  const project = await projectEntries(workspace)
  const filesBySession = new Map()
  for (const entry of project.entries) {
    const bucket = filesBySession.get(entry.file) ?? []
    bucket.push(entry)
    filesBySession.set(entry.file, bucket)
  }
  const files = [...filesBySession.keys()].filter((file) => onlyFile === undefined || file === onlyFile).sort()
  const checked = []
  let total = 0
  for (const file of files) {
    let previous = GENESIS
    let number = 0
    for (const entry of filesBySession.get(file) ?? []) {
      number += 1
      if (entry.corrupt === true) {
        return { ok: false, brokenAt: { file, line: number, id: unknownId(entry.raw), reason: 'line is not valid JSON' }, files: checked }
      }
      const record = entry.record
      if (record.prevHash !== previous) {
        return {
          ok: false,
          brokenAt: { file, line: number, id: record.id, reason: `prevHash ${String(record.prevHash).slice(0, 12)} does not match the previous line's hash ${previous.slice(0, 12)}` },
          files: checked,
        }
      }
      const recomputed = hashRecord(record)
      if (recomputed !== record.hash) {
        return {
          ok: false,
          brokenAt: { file, line: number, id: record.id, reason: `hash mismatch: stored ${String(record.hash).slice(0, 12)}, recomputed ${recomputed.slice(0, 12)}` },
          files: checked,
        }
      }
      previous = record.hash
      total += 1
    }
    checked.push(file)
  }
  const supersedes = (await supersedeMap(workspace)).size
  return { ok: true, records: total, files: checked, supersedes, checkedAt: new Date().toISOString() }
}

/**
 * Trim a damaged journal back to its last complete, chain-consistent line.
 *
 * A torn tail (a kill or ENOSPC in the middle of a write) cannot be "repaired" in
 * the sense of recovering the lost record — the bytes were never written. What can
 * be recovered is everything before it: the append-only contract says the intact
 * prefix is still a valid chain. A copy is kept next to the journal first, so the
 * operation is reversible by hand.
 *
 * @param {string} workspace project directory
 * @param {string} [onlyFile] journal file name, e.g. `s1.jsonl`
 * @returns {Promise<Array<{file: string, removedBytes: number, keptLines: number, backup: string}>>}
 */
async function repairJournal(workspace, onlyFile) {
  const dir = join(workspace, NOTEBOOK_DIR)
  let names
  try {
    names = await readdir(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const targets = names
    .filter((name) => name.endsWith('.jsonl') && name !== SUPERSEDE_FILE)
    .filter((name) => onlyFile === undefined || name === onlyFile)
    .sort()

  const repairs = []
  for (const name of targets) {
    const file = join(dir, name)
    const raw = await readFile(file)
    if (raw.length === 0) continue

    let previous = GENESIS
    let kept = 0
    let lines = 0
    let offset = 0
    while (offset < raw.length) {
      const newline = raw.indexOf(0x0a, offset)
      if (newline === -1) break // a trailing fragment, not a line
      const text = raw.subarray(offset, newline).toString('utf8').trim()
      offset = newline + 1
      if (text.length === 0) continue
      let record
      try {
        record = JSON.parse(text)
      } catch {
        break
      }
      if (record?.prevHash !== previous) break
      if (hashRecord(record) !== record?.hash) break
      previous = record.hash
      kept = offset
      lines += 1
    }

    if (kept === raw.length) continue // nothing torn
    const backup = `${file}.bak-${Date.now()}`
    await copyFile(file, backup)
    await truncate(file, kept)
    repairs.push({ file: name, removedBytes: raw.length - kept, keptLines: lines, backup })
  }
  return repairs
}

/** Compare a stored record against the current filesystem. */
async function recheckArtifacts(workspace, artifacts) {
  if (!Array.isArray(artifacts)) return []
  const checked = []
  for (const artifact of artifacts) {
    if (typeof artifact?.path !== 'string') continue
    const absolute = isAbsolute(artifact.path) ? artifact.path : resolve(workspace, artifact.path)
    const previous = typeof artifact.sha256 === 'string' ? artifact.sha256 : undefined
    let info
    try {
      info = await stat(absolute)
    } catch {
      info = undefined
    }
    if (info === undefined || !info.isFile()) {
      checked.push({ ...artifact, status: 'missing', currentSha256: null })
      continue
    }
    let current
    try {
      current = await sha256File(absolute)
    } catch {
      checked.push({ ...artifact, status: 'missing', currentSha256: null })
      continue
    }
    const status = previous === undefined ? 'unchanged' : previous === current ? 'unchanged' : 'changed'
    checked.push({ ...artifact, sha256: previous ?? current, currentSha256: current, status })
  }
  return checked
}

function toStringArray(value, limit = 50) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, limit)
}

const CJK_RANGE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/
const TOKEN_PATTERN = /[a-z0-9а-яё_+-]+|[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]+/gi

/**
 * Search terms from free text.
 *
 * Latin and Cyrillic words are split on punctuation; a run of CJK characters is
 * one term and also yields its single characters, because those languages are
 * written without spaces — dropping the run (as 0.8.1 did) made a Chinese or
 * Japanese title unsearchable.
 */
function tokenize(text) {
  const terms = []
  for (const match of String(text ?? '').toLowerCase().matchAll(TOKEN_PATTERN)) {
    const token = match[0]
    if (CJK_RANGE.test(token)) {
      terms.push(token)
      if (token.length > 1) for (const char of token) terms.push(char)
      continue
    }
    if (token.length > 1) terms.push(token)
  }
  return terms
}

const SEARCH_STOP = new Set(['and', 'the', 'for', 'with', 'from', 'that', 'this', 'из', 'для', 'что', 'как', 'или', 'при'])

/** Lexical ranking: title > tags > body, recency as tiebreak. */
function scoreEntry(record, terms) {
  const title = tokenize(record.title)
  const tags = tokenize(Array.isArray(record.tags) ? record.tags.join(' ') : '')
  const body = tokenize(record.body)
  const code = tokenize(record.code?.source)
  let score = 0
  for (const term of terms) {
    if (title.includes(term)) score += 5
    if (tags.includes(term)) score += 3
    if (code.includes(term)) score += 2
    if (body.includes(term)) score += 1
    if (String(record.title ?? '').toLowerCase().includes(term) && !title.includes(term)) score += 3
  }
  return score
}

/** Digest refreshers registered by each mounted plugin instance. */
const digestRefreshers = new Set()

/** workspace -> { at, paths } — artifacts that already appear in some record. */
const recordedArtifactCache = new Map()
const RECORDED_TTL_MS = 5000

async function recordedArtifacts(workspace, force = false) {
  const hit = recordedArtifactCache.get(workspace)
  if (force !== true && hit !== undefined && Date.now() - hit.at < RECORDED_TTL_MS) return hit.paths
  const paths = new Set()
  try {
    const { entries } = await projectEntries(workspace)
    for (const entry of entries) {
      for (const artifact of entry.record?.artifacts ?? []) {
        if (typeof artifact?.path === 'string') paths.add(artifact.path)
      }
    }
  } catch {
    /* an unreadable journal only means we cannot dedupe this round */
  }
  recordedArtifactCache.set(workspace, { at: Date.now(), paths })
  return paths
}

/**
 * Append a machine-written `note` for files a tool just produced.
 *
 * Provenance knows which files a step wrote; the journal is where the model
 * explains them. Without this every artifact exists only in `steps.jsonl`, which
 * nobody reads when asking "what did we actually produce?". The note is tagged
 * `auto` and deduplicated against every artifact already cited in the project, so
 * a file recorded by hand earlier is never shadowed by a stub.
 *
 * @returns the appended record, or null when there was nothing new to note.
 */
export async function appendAutoNote(workspace, input) {
  if (typeof workspace !== 'string' || workspace.length === 0) return null
  const sessionId = safeSessionId(input?.sessionId ?? 'global')
  const seen = await recordedArtifacts(workspace)
  const artifacts = []
  for (const item of Array.isArray(input?.artifacts) ? input.artifacts : []) {
    const path = typeof item?.path === 'string' ? item.path.trim() : ''
    if (path.length === 0 || seen.has(path)) continue
    // A report may name a thing that is not a file ("PROJECT.md (вопрос)" was the
    // bug); recording it would add a permanently missing artifact to the journal.
    const absolute = isAbsolute(path) ? path : join(workspace, path)
    try {
      if (!statSync(absolute).isFile()) continue
    } catch {
      continue
    }
    const artifact = { path, status: 'unchanged' }
    if (typeof item?.sha256 === 'string' && item.sha256.length > 0) artifact.sha256 = item.sha256
    artifacts.push(artifact)
  }
  if (artifacts.length === 0) return null

  const dir = join(workspace, NOTEBOOK_DIR)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${sessionId}.jsonl`)

  const toolName = typeof input?.toolName === 'string' ? input.toolName : 'tool'
  const count = artifacts.length
  const template = {
    schemaVersion: SCHEMA_VERSION,
    id: `n_${ulid()}`,
    sessionId,
    turnId: null,
    type: 'note',
    title: `${toolName} produced ${count} file${count === 1 ? '' : 's'}`,
    body: [
      `Recorded automatically from provenance, not written by the model.`,
      `Step: ${String(input?.stepId ?? 'unknown')} · tool: ${toolName}`,
      `Files: ${artifacts.map((artifact) => artifact.path).join(', ')}`,
      'Reply to this note with what the files show; the record stays as the file-level trace.',
    ].join('\n'),
    code: null,
    tags: ['auto'],
    artifacts,
    results: [],
    confidence: null,
    limitations: [],
    outcome: null,
    execution: null,
    evidence: [],
    supersedes: null,
    relatesTo: [],
    createdAt: new Date().toISOString(),
    auto: true,
    stepId: typeof input?.stepId === 'string' ? input.stepId : null,
  }
  let record
  try {
    record = await appendRecordOnce(file, template, [])
  } catch (error) {
    // An automatic note must never break the tool that produced the files.
    if (error?.code === 'TORN_TAIL') return null
    throw error
  }
  for (const artifact of artifacts) seen.add(artifact.path)
  for (const refresh of digestRefreshers) {
    try {
      refresh(workspace)
    } catch {
      /* digest refresh is cosmetic */
    }
  }
  return record
}

export function apply(ctx, config) {
  /** workspace -> rendered digest, refreshed off the hot path. */
  const digestCache = new Map()
  const refreshTimer = new Map()

  /** Project directory plus how it was chosen; the tool prints both. */
  function workspaceFor(exec) {
    return resolveWorkspace(ctx, exec, config)
  }

  async function buildDigest(workspace) {
    const { entries } = await projectEntries(workspace)
    const superseded = await supersedeMap(workspace)
    const records = entries.filter((entry) => entry.record !== null).map((entry) => entry.record)
    const alive = records.filter((record) => !superseded.has(record.id))

    const openHypotheses = alive
      .filter((record) => record.type === 'hypothesis' && (record.outcome === null || record.outcome === 'inconclusive'))
      .slice(-5)
    const decisions = alive.filter((record) => record.type === 'decision').slice(-5)
    const unverified = alive.filter((record) => record.execution?.state === 'unverified').slice(-3)
    const missing = alive.filter((record) => Array.isArray(record.artifacts) && record.artifacts.some((a) => a?.status === 'missing'))

    const lines = []
    if (records.length === 0) return ''
    lines.push(`research notebook (${records.length} records, ${openHypotheses.length} open hypotheses)`)
    if (openHypotheses.length > 0) {
      lines.push('open hypotheses:')
      for (const record of openHypotheses) lines.push(`  ${record.id} ${record.title}`)
    }
    if (decisions.length > 0) {
      lines.push('recent decisions:')
      for (const record of decisions) lines.push(`  ${record.id} ${record.title}`)
    }
    if (unverified.length > 0) {
      lines.push(`unverified executions (completed without evidence): ${unverified.length}`)
      for (const record of unverified) lines.push(`  ${record.id} ${record.title}`)
    }
    if (missing.length > 0) lines.push(`records with missing artifacts: ${missing.length} — re-derive before relying on them`)
    lines.push('record every hypothesis before a run and every decision with its reason; corrections go through supersedes.')
    return lines.join('\n').slice(0, 2400)
  }

  function scheduleDigest(workspace) {
    const existing = refreshTimer.get(workspace)
    if (existing !== undefined) return
    const timer = setTimeout(() => {
      refreshTimer.delete(workspace)
      buildDigest(workspace)
        .then((text) => digestCache.set(workspace, text))
        .catch(() => undefined)
    }, 250)
    if (typeof timer.unref === 'function') timer.unref()
    refreshTimer.set(workspace, timer)
  }
  digestRefreshers.add(scheduleDigest)

  // Seed only when this process directory owns a journal: an empty digest would
  // cost prompt space in every session of every other project.
  if (existsSync(join(process.cwd(), NOTEBOOK_DIR))) scheduleDigest(process.cwd())

  if (typeof ctx.on === 'function') {
    // The step knows which agent runs and which project it belongs to; the
    // journal of that project is refreshed before the model reads its prompt.
    ctx.on('agent/pre-step', (payload, next) => {
      try {
        const workspace = sessionWorkspace(ctx, payload?.agent?.id)
        if (workspace !== undefined) scheduleDigest(workspace)
      } catch {
        /* a prompt refresh must never fail a step */
      }
      return typeof next === 'function' ? next() : undefined
    })
    ctx.on('session/event', (session) => {
      try {
        const workspace = session?.header?.cwd
        if (typeof workspace === 'string' && workspace.length > 0) scheduleDigest(workspace)
      } catch {
        /* an unreadable header only skips this refresh */
      }
    })
  }

  ctx.systemPrompt.section({
    name: 'research-record-digest',
    order: 60,
    text: (context) => {
      const agent = scopeSubject(context)
      const workspace = agent === undefined ? undefined : sessionWorkspace(ctx, agent.id)
      if (workspace !== undefined) {
        const digest = digestCache.get(workspace)
        return digest === undefined || digest.length === 0 ? '' : digest
      }
      // A single known project is unambiguous even when the host omits the scope.
      if (digestCache.size === 1) {
        const [only] = digestCache.values()
        return typeof only === 'string' ? only : ''
      }
      return ''
    },
  })

  ctx.tools.register({
    name: 'notebook',
    description:
      'Append one record to the research notebook (hash-chained, append-only). Use it before a run (hypothesis, method), after a run (observation with numbers, units and the artifact path), and for every decision with its reason. execution.state=completed requires execution.evidence or the record is downgraded to unverified.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [...TYPE_SET], description: 'Record kind.' },
        title: { type: 'string', description: 'One-line claim or label. Required.' },
        body: { type: 'string', description: 'Markdown body: what was tried, what was seen, what it means.' },
        code: {
          type: 'object',
          description: 'Opted code that produced the result.',
          properties: { source: { type: 'string' }, lang: { type: 'string' } },
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Free-form tags for search.' },
        artifacts: {
          type: 'array',
          description: 'Files this record produced or relied on; hashed now and re-checked on read.',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, sha256: { type: 'string' } },
            required: ['path'],
          },
        },
        results: { type: 'array', items: {}, description: 'Structured numbers, one object per row.' },
        confidence: { type: 'string', enum: [...CONFIDENCE_SET] },
        limitations: { type: 'array', items: { type: 'string' } },
        outcome: {
          type: 'string',
          enum: [...OUTCOME_SET],
          description: 'Only for observation/hypothesis. signal = the effect was seen, null = looked and found nothing, technical-failure = the run broke.',
        },
        execution: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: [...STATE_SET] },
            evidence: { type: 'string', description: 'Path to the log/CSV that proves the execution happened.' },
          },
        },
        evidence: {
          type: 'array',
          description: 'Links to earlier records this one leans on.',
          items: {
            type: 'object',
            properties: {
              entryId: { type: 'string' },
              relation: { type: 'string', enum: [...RELATION_SET] },
              rationale: { type: 'string' },
            },
            required: ['entryId', 'relation'],
          },
        },
        supersedes: { type: 'string', description: 'Id of the record this one corrects.' },
        relatesTo: { type: 'array', items: { type: 'string' } },
      },
      required: ['type', 'title'],
    },
    output: {
      schema: { type: 'object' },
      render(args, value) {
        if (value?.ok !== true) return [{ type: 'text', text: `notebook: rejected — ${value?.error ?? 'unknown error'}` }]
        const record = value.record
        const lines = [`notebook: ${record.type} ${record.id} "${record.title}"`, `hash:     ${record.hash}`, `prevHash: ${record.prevHash}`]
        if (value.journal) lines.push(`journal:  ${value.journal}${value.workspaceSource ? ` (workspace from ${value.workspaceSource})` : ''}`)
        if (record.execution?.state) lines.push(`execution: ${record.execution.state}${record.execution.evidence ? ` (${record.execution.evidence})` : ''}`)
        if (Array.isArray(record.artifacts) && record.artifacts.length > 0) {
          for (const artifact of record.artifacts) lines.push(`artifact: ${artifact.path} ${artifact.status ?? ''} ${artifact.sha256 ?? ''}`.trim())
        }
        if (Array.isArray(value.warnings) && value.warnings.length > 0) {
          lines.push(`warnings (${value.warnings.length}):`)
          for (const warning of value.warnings) lines.push(`  - ${warning}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const { cwd: workspace, source } = await workspaceFor(exec)
      const sessionId = safeSessionId(exec?.agent?.id ?? 'global')

      const type = String(args?.type ?? '')
      if (!TYPE_SET.has(type)) {
        return { ok: false, error: `type must be one of: ${[...TYPE_SET].join(', ')}` }
      }
      const title = typeof args?.title === 'string' ? args.title.trim() : ''
      if (title.length === 0) return { ok: false, error: 'title is required for every record' }
      const approximateBytes = JSON.stringify(args ?? {}).length
      if (approximateBytes > MAX_INPUT_BYTES) {
        return { ok: false, error: `record input is too large: ~${approximateBytes} bytes, limit ${MAX_INPUT_BYTES}` }
      }
      if (exec?.signal?.aborted === true) return { ok: false, error: 'cancelled before the record was written' }

      const warnings = []
      const dir = join(workspace, NOTEBOOK_DIR)
      await mkdir(dir, { recursive: true })
      const file = join(dir, `${sessionId}.jsonl`)

      let outcome = args?.outcome
      if (outcome !== undefined && outcome !== null) {
        if (!OUTCOME_SET.has(outcome)) {
          warnings.push(`outcome "${outcome}" is not in the enum; dropped`)
          outcome = null
        } else if (!OUTCOME_TYPES.has(type)) {
          warnings.push(`outcome is only allowed for observation/hypothesis, not ${type}; dropped`)
          outcome = null
        }
      } else {
        outcome = null
      }

      let execution
      if (args?.execution !== undefined && args.execution !== null) {
        const requested = String(args.execution.state ?? '')
        const evidence = typeof args.execution.evidence === 'string' ? args.execution.evidence.trim() : ''
        let state = STATE_SET.has(requested) ? requested : 'attempted'
        if (!STATE_SET.has(requested)) warnings.push(`execution.state "${requested}" is not in the enum; recorded as attempted`)
        if (state === 'completed' && evidence.length === 0) {
          state = 'unverified'
          warnings.push('execution.state=completed without execution.evidence was downgraded to unverified — point it at the log/CSV that proves the run')
        }
        execution = { state, evidence: evidence.length > 0 ? evidence : null }
      }

      const artifacts = []
      if (Array.isArray(args?.artifacts)) {
        for (const requested of args.artifacts.slice(0, 50)) {
          if (typeof requested?.path !== 'string' || requested.path.trim().length === 0) continue
          const path = requested.path.trim()
          const absolute = isAbsolute(path) ? path : resolve(workspace, path)
          let info
          try {
            info = await stat(absolute)
          } catch {
            info = undefined
          }
          const previous = typeof requested.sha256 === 'string' && requested.sha256.length > 0 ? requested.sha256 : undefined
          if (info === undefined || !info.isFile()) {
            const artifact = { path, sha256: previous ?? null, status: 'missing' }
            artifacts.push(artifact)
            warnings.push(`artifact ${path} does not exist — recorded with status missing`)
            continue
          }
          const current = await sha256File(absolute)
          const artifact = { path, sha256: previous ?? current, status: previous === undefined || previous === current ? 'unchanged' : 'changed' }
          if (artifact.status === 'changed') warnings.push(`artifact ${path} hash differs from the supplied sha256 — recorded as changed`)
          artifacts.push(artifact)
        }
      }

      const index = new Map()
      const project = await projectEntries(workspace)
      for (const entry of project.entries) if (entry.record?.id !== undefined) index.set(entry.record.id, entry.record)

      const evidence = []
      if (Array.isArray(args?.evidence)) {
        for (const requested of args.evidence.slice(0, 50)) {
          const entryId = typeof requested?.entryId === 'string' ? requested.entryId.trim() : ''
          if (entryId.length === 0) continue
          if (!index.has(entryId)) {
            warnings.push(`evidence entryId ${entryId} is not in this project's notebook; dropped`)
            continue
          }
          const relation = RELATION_SET.has(requested?.relation) ? requested.relation : 'context'
          if (relation !== requested?.relation) warnings.push(`evidence relation "${requested?.relation}" is not in the enum; recorded as context`)
          evidence.push({
            entryId,
            relation,
            rationale: typeof requested?.rationale === 'string' ? requested.rationale : '',
          })
        }
      }

      let supersedes = null
      if (typeof args?.supersedes === 'string' && args.supersedes.trim().length > 0) {
        const target = args.supersedes.trim()
        if (!index.has(target)) warnings.push(`supersedes ${target} does not exist; dropped`)
        else supersedes = target
      }

      const relatesTo = []
      for (const requested of toStringArray(args?.relatesTo, 50)) {
        if (!index.has(requested)) {
          warnings.push(`relatesTo ${requested} does not exist; dropped`)
          continue
        }
        relatesTo.push(requested)
      }

      const createdAt = new Date().toISOString()
      let record = {
        schemaVersion: SCHEMA_VERSION,
        id: `n_${ulid()}`,
        sessionId,
        turnId: typeof exec?.turnId === 'string' ? exec.turnId : null,
        type,
        title,
        body: typeof args?.body === 'string' ? args.body : '',
        code:
          args?.code !== undefined && typeof args.code === 'object'
            ? { source: String(args.code.source ?? ''), lang: String(args.code.lang ?? '') }
            : null,
        tags: toStringArray(args?.tags),
        artifacts,
        results: Array.isArray(args?.results) ? args.results.slice(0, 200) : [],
        confidence: CONFIDENCE_SET.has(args?.confidence) ? args.confidence : null,
        limitations: toStringArray(args?.limitations),
        outcome,
        execution: execution ?? null,
        evidence,
        supersedes,
        relatesTo,
        createdAt,
      }
      try {
        record = await appendRecordOnce(file, record, warnings)
      } catch (error) {
        if (error?.code === 'TORN_TAIL') {
          return { ok: false, error: error.message, hint: 'call notebook_verify with repair:true to trim the torn tail', journal: file }
        }
        throw error
      }
      if (supersedes !== null) {
        try {
          await appendLine(
            join(dir, SUPERSEDE_FILE),
            `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, targetId: supersedes, byId: record.id, at: createdAt, sessionId })}\n`,
          )
        } catch (error) {
          // The record itself is already durable; a failed link must not reject it.
          warnings.push(`supersede link was not written: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      scheduleDigest(workspace)
      return { ok: true, record, warnings, digest: record.hash, journal: file, workspace, workspaceSource: source }
    },
  })

  ctx.tools.register({
    name: 'notebook_search',
    description:
      'Search this project\'s research notebook (lexical, title-weighted) or read one record by id. action=read with expectedDigest refuses when the stored record no longer matches the digest you last saw. Artifact hashes are re-checked on read: status unchanged / changed / missing.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'read'], description: 'search (default) or read one record.' },
        query: { type: 'string', description: 'Words to look for (search).' },
        id: { type: 'string', description: 'Record id (read).' },
        expectedDigest: { type: 'string', description: 'read: the record hash you expect; mismatch is a refusal.' },
        type: { type: 'string', enum: [...TYPE_SET], description: 'Filter by record kind.' },
        tag: { type: 'string', description: 'Filter by tag.' },
        scope: { type: 'string', enum: ['session', 'project'], description: 'session (default) = this session\'s journal, project = every journal in the workspace.' },
        limit: { type: 'number', description: 'Max records (default 10).' },
      },
    },
    output: {
      schema: { type: 'object' },
      render(args, value) {
        if (value?.ok !== true) return [{ type: 'text', text: `notebook_search: ${value?.error ?? 'failed'}` }]
        if (value.action === 'read') {
          const record = value.record
          const lines = [
            `${record.type} ${record.id} "${record.title}"`,
            `created:   ${record.createdAt}  session: ${record.sessionId}`,
            `hash:      ${record.hash}`,
            `prevHash:  ${record.prevHash}`,
          ]
          if (record.supersededBy !== undefined) lines.push(`superseded by: ${record.supersededBy}`)
          if (record.execution?.state) lines.push(`execution: ${record.execution.state}${record.execution.evidence ? ` (${record.execution.evidence})` : ''}`)
          if (Array.isArray(record.artifacts)) {
            for (const artifact of record.artifacts) lines.push(`artifact:  ${artifact.path} [${artifact.status ?? 'unknown'}] ${artifact.sha256 ?? ''}`.trim())
          }
          if (record.body) lines.push('', record.body)
          if (Array.isArray(value.warnings) && value.warnings.length > 0) {
            lines.push('', `warnings: ${value.warnings.join('; ')}`)
          }
          return [{ type: 'text', text: lines.join('\n') }]
        }
        const lines = [`notebook: ${value.total} match(es), showing ${value.results.length}`]
        for (const hit of value.results) {
          lines.push(`${hit.score.toString().padStart(3)} ${hit.type.padEnd(11)} ${hit.id} ${hit.title}${hit.state ? ` [${hit.state}]` : ''}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const { cwd: workspace } = await workspaceFor(exec)
      const sessionId = safeSessionId(exec?.agent?.id ?? 'global')
      const action = args?.action === 'read' ? 'read' : 'search'
      const project = await projectEntries(workspace)
      const superseded = await supersedeMap(workspace)
      const usable = project.entries.filter((entry) => entry.record !== null)

      if (action === 'read') {
        const id = typeof args?.id === 'string' ? args.id.trim() : ''
        if (id.length === 0) return { ok: false, error: 'id is required for action=read' }
        const hit = usable.find((entry) => entry.record.id === id)
        if (hit === undefined) return { ok: false, error: `no record with id ${id} in this project` }
        const warnings = []
        // Recompute: `hash` is a field of the record, so trusting the stored value
        // would report a forged record as valid.
        const recomputed = hashRecord(hit.record)
        if (recomputed !== hit.record.hash) {
          return {
            ok: false,
            error: `digest mismatch for ${id}: stored ${hit.record.hash}, recomputed ${recomputed} — the record was tampered with or belongs to another chain`,
          }
        }
        if (typeof args?.expectedDigest === 'string' && args.expectedDigest.length > 0 && args.expectedDigest !== recomputed) {
          return {
            ok: false,
            error: `digest mismatch for ${id}: stored ${recomputed}, expected ${args.expectedDigest} — the record was tampered with or belongs to another chain`,
          }
        }
        const record = { ...hit.record }
        record.artifacts = await recheckArtifacts(workspace, hit.record.artifacts)
        for (const artifact of record.artifacts) {
          if (artifact.status === 'changed') warnings.push(`artifact ${artifact.path} changed since it was recorded`)
          if (artifact.status === 'missing') warnings.push(`artifact ${artifact.path} is missing`)
        }
        const link = superseded.get(record.id)
        if (link !== undefined) record.supersededBy = link.byId
        return { ok: true, action, record, warnings, file: hit.file, line: hit.line }
      }

      const scope = args?.scope === 'project' ? 'project' : 'session'
      // Models pass "5" as often as 5: a numeric string must mean five, not the
      // default ten.
      const rawLimit = typeof args?.limit === 'string' ? Number(args.limit) : args?.limit
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, Math.trunc(rawLimit))) : 10
      const terms = tokenize(args?.query).filter((term) => !SEARCH_STOP.has(term)).slice(0, 12)
      const candidates = usable.filter((entry) => {
        if (scope === 'session' && entry.record.sessionId !== sessionId) return false
        if (typeof args?.type === 'string' && entry.record.type !== args.type) return false
        if (typeof args?.tag === 'string' && !(Array.isArray(entry.record.tags) && entry.record.tags.includes(args.tag))) return false
        return true
      })

      const scored = []
      for (const entry of candidates) {
        if (terms.length === 0) {
          scored.push({ record: entry.record, score: 0 })
          continue
        }
        const score = scoreEntry(entry.record, terms)
        if (score > 0) scored.push({ record: entry.record, score })
      }
      scored.sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        // Equal score: the newer record answers "what do I think now" better.
        const byTime = String(right.record.createdAt).localeCompare(String(left.record.createdAt))
        if (byTime !== 0) return byTime
        // Two records can share a millisecond; a ULID is time-ordered, so the
        // identifier settles it instead of leaving the order to the file.
        return String(right.record.id).localeCompare(String(left.record.id))
      })
      const results = scored.slice(0, limit).map(({ record, score }) => ({
        id: record.id,
        type: record.type,
        title: record.title,
        score,
        createdAt: record.createdAt,
        state: record.execution?.state ?? null,
        supersededBy: superseded.get(record.id)?.byId ?? null,
      }))
      return { ok: true, action, scope, total: scored.length, results, terms }
    },
  })

  ctx.tools.register({
    name: 'notebook_verify',
    description:
      'Recompute the whole notebook hash chain (prevHash/hash per line, genesis at the file start) and report the first broken line. ' +
      'repair=true trims a torn tail (a kill or a full disk during a write) back to the last complete line and keeps a .bak copy; ' +
      'it cannot restore the lost record, and it refuses a chain that is broken in the middle. ' +
      'Use it before trusting a journal or after someone edited it by hand.',
    parameters: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Check one session journal only (default: every journal in the workspace).' },
        repair: { type: 'boolean', description: 'Trim a torn tail to the last intact line (default false).' },
      },
    },
    output: {
      schema: { type: 'object' },
      render(args, value) {
        if (value.ok === true) {
          const lines = [`notebook_verify: OK — ${value.records} record(s) in ${value.files.length} journal(s), ${value.supersedes} supersede link(s)`]
          for (const file of value.files) lines.push(`  ok ${file}`)
          for (const repair of Array.isArray(value.repaired) ? value.repaired : []) {
            lines.push(`  repaired ${repair.file}: removed ${repair.removedBytes} byte(s) after the last intact line, kept ${repair.keptLines} record(s), backup ${repair.backup}`)
          }
          return [{ type: 'text', text: lines.join('\n') }]
        }
        const lines = [`notebook_verify: FAILED at ${value.brokenAt?.file}:${value.brokenAt?.line} (${value.brokenAt?.id ?? 'unknown'})`, `reason: ${value.brokenAt?.reason}`]
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const { cwd: workspace } = await workspaceFor(exec)
      const only = typeof args?.session === 'string' ? `${safeSessionId(args.session)}.jsonl` : undefined
      if (args?.repair === true) {
        const repaired = await repairJournal(workspace, only)
        const verdict = await verifyJournal(workspace, only)
        if (verdict.ok === true) scheduleDigest(workspace)
        return { ...verdict, repaired }
      }
      const result = await verifyJournal(workspace, only)
      if (result.ok === true) scheduleDigest(workspace)
      return result
    },
  })

  // The Notebook panel reads the same journal over HTTP: the browser cannot
  // touch `.dsh/` itself, and showing the stored line (not a re-render) is the
  // point — the panel must display what the hash chain covers.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.webServer.register({
        kind: 'exact',
        path: '/notebook',
        handler: async (req, res) => {
          const send = (status, payload) => {
            res.statusCode = status
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.setHeader('cache-control', 'no-store')
            res.end(JSON.stringify(payload))
          }
          try {
            const url = new URL(req.url ?? '/notebook', 'http://localhost')
            const resolved = await panelWorkspace(ctx, url.searchParams.get('workspace'))
            if (resolved.ok !== true) {
              send(403, { ok: false, error: resolved.error })
              return
            }
            const workspace = resolved.workspace
            const session = url.searchParams.get('session')
            const only = session !== null && session.length > 0 ? `${safeSessionId(session)}.jsonl` : undefined
            if (url.searchParams.get('verify') === '1') {
              send(200, { ok: true, workspace, verify: await verifyJournal(workspace, only) })
              return
            }
            let { entries, files } = await projectEntries(workspace)
            if (only !== undefined) {
              files = files.filter((file) => file === only)
              entries = entries.filter((entry) => entry.file === only)
            }
            const superseded = await supersedeMap(workspace)
            const records = entries
              .filter((entry) => entry.record !== null)
              .map((entry) => ({ ...entry.record, supersededBy: superseded.get(entry.record.id) ?? null }))
            send(200, { ok: true, workspace, files, records, corrupt: entries.filter((entry) => entry.record === null).length })
          } catch (error) {
            send(500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      })
    })
  }
}

function unknownId(raw) {
  try {
    return JSON.parse(raw)?.id ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export default { name, inject, apply }
