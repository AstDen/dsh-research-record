/**
 * dsh-research-record — provenance: which step produced which file, from what.
 *
 * `tools/result` runs after every tool call, arguments included, so the graph is
 * built by observation — the arguments are never rewritten.
 *
 * Storage: `<workspace>/.dsh/provenance/<sessionId>/steps.jsonl`, append-only.
 * One line per tool call:
 *
 *   { schemaVersion, id (tool call id), sessionId, runId, startedAt, timestamp,
 *     toolName, args, isError, model, role, inputs[], outputs[],
 *     fidelity: "observed"|"inferred", environment{node,python,cwd} }
 *
 * Edges:
 *   - `write` / `edit`       → the target file as an output, hashed right away
 *     (observed); `edit` also keeps the previous hash as an input when the
 *     snapshot knew it, so the walk can tell versions apart;
 *   - `bash`                 → a workspace scan: files whose mtime+size moved
 *     become outputs, hashed only if they changed (observed). When the scan
 *     cannot finish the step is recorded as `inferred` with no output edges;
 *   - anything path-shaped in the arguments (`file_path`, `path`, …) → inputs.
 *
 * Limits, per the brief: ≤200 edges per step, files >512 MB are recorded with
 * `sha256: "unhashed"`, workspaces above 20 000 files degrade to mtime-only
 * detection (`"degraded"` in the step).
 *
 * Tools: `provenance_of_file(path)` walks the lineage upwards (≤12 hops,
 * ≤60 nodes, one version per path); `provenance_verify()` checks the chain of
 * every steps file. `GET /provenance?path=…` serves the same walk to the web UI.
 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { appendLine } from './lock.js'
import { activeWorkspace, panelWorkspace, resolveWorkspace } from './notebook.js'
import { appendAutoNote } from './notebook.js'
import { getService } from './services.js'

export const name = 'research-record-provenance'
export const inject = ['tools']

const SCHEMA_VERSION = 1
const PROVENANCE_DIR = '.dsh/provenance'
const MAX_EDGES = 200
/** Millisecond of slack when an ISO stamp is compared with a filesystem mtime. */
const CLOCK_SLACK_MS = 5

const MAX_HASH_BYTES = 512 * 1024 * 1024
const MAX_SCAN_FILES = 20000
const SKIP_DIRS = new Set(['node_modules', '.git', '.dsh', 'dist', 'build', 'target', '.venv', 'venv', '__pycache__'])
const WRITE_TOOLS = new Set(['write', 'edit'])
const PATH_KEYS = ['file_path', 'path', 'target', 'destination', 'source', 'src', 'file', 'dir', 'directory']
const PATHISH = /\.(csv|tsv|json|jsonl|md|txt|log|py|js|mjs|cjs|ts|sh|yaml|yml|toml|npy|npz|h5|hdf5|stl|vtk|dat|parquet|png|pdf|xlsx|zip|gz|tgz|ipynb)$/i

function safeId(value) {
  const text = String(value ?? 'global')
  return text.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'global'
}

async function sha256File(path) {
  const { createReadStream } = await import('node:fs')
  const hash = createHash('sha256')
  await new Promise((accept, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', accept)
  })
  return hash.digest('hex')
}

/** Workspace-relative POSIX form of a path argument (absolute when outside). */
function relativize(pathValue, workspace) {
  const absolute = isAbsolute(String(pathValue)) ? String(pathValue) : resolve(workspace, String(pathValue))
  const rel = relative(workspace, absolute)
  if (rel.length === 0) return '.'
  if (rel === '..' || rel.startsWith('..' + '/') || rel.startsWith('..\\')) return absolute
  return rel.split(/[\\/]/).join('/')
}

/** Path-shaped argument values, relativized (used for tools with no scan). */
function pathArgs(args, workspace) {
  if (args === null || typeof args !== 'object') return []
  const found = []
  for (const key of PATH_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0 && value.length <= 1024) {
      found.push(relativize(value, workspace))
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.length > 0 && item.length <= 1024) found.push(relativize(item, workspace))
      }
    }
  }
  return [...new Set(found)]
}

/** Keys whose value is file content, not an intent: the journal keeps the size only. */
const REDACTED_ARG_KEYS = new Set(['content', 'old_string', 'new_string', 'newText', 'oldText'])

/** Commands keep no absolute workspace path in the journal: relativize, trim. */
function cleanArgs(args, workspace) {
  if (args === null || typeof args !== 'object') return {}
  const copy = {}
  for (const [key, value] of Object.entries(args)) {
    if (REDACTED_ARG_KEYS.has(key)) {
      // A steps.jsonl is copied into reports, shared and committed. File content
      // is the one thing that must never end up there — only its size.
      copy[key] = { redacted: true, chars: typeof value === 'string' ? value.length : null }
      continue
    }
    if (typeof value === 'string') {
      const relative = isAbsolute(value) ? relativize(value, workspace) : value
      copy[key] = relative.length > 1024 ? `${relative.slice(0, 1024)}…` : relative
      continue
    }
    if (Array.isArray(value)) {
      copy[key] = value.map((item) => (typeof item === 'string' && isAbsolute(item) ? relativize(item, workspace) : item))
      continue
    }
    copy[key] = value
  }
  return copy
}

/** Shell words that name a file (so a bash step records what it touched). */
function bashPathTokens(command) {
  const tokens = String(command).match(/"[^"]*"|'[^']*'|`[^`]*`|[^\s;&|<>()]+/g) ?? []
  const found = []
  for (const raw of tokens) {
    const token = raw.replace(/^['"`]|['"`]$/g, '')
    if (token.length === 0 || token.startsWith('-') || token.startsWith('$')) continue
    if (!token.includes('/') && !token.includes('.') && !PATHISH.test(token)) continue
    if (token === '.' || token === '..') continue
    if (/^[a-z]+$/.test(token)) continue
    found.push(token)
  }
  return found
}

async function edgeFor(workspace, pathValue, previousHash) {
  const absolute = isAbsolute(pathValue) ? pathValue : resolve(workspace, pathValue)
  const path = relativize(absolute, workspace)
  let info
  try {
    info = await stat(absolute)
  } catch {
    return { path, sha256: null, size: null, status: 'missing' }
  }
  if (!info.isFile()) return { path, sha256: null, size: null, status: 'not-a-file' }
  if (info.size > MAX_HASH_BYTES) return { path, sha256: 'unhashed', size: info.size, status: 'too-large' }
  let sha256
  try {
    sha256 = await sha256File(absolute)
  } catch {
    return { path, sha256: null, size: info.size, status: 'unreadable' }
  }
  return { path, sha256, size: info.size, status: 'ok', previousSha256: previousHash ?? null }
}

/** Recursive mtime+size scan, with the same skip list as the journal's limits. */
async function scanWorkspace(workspace) {
  const snapshot = new Map()
  let count = 0
  let degraded = false
  async function walk(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      count += 1
      if (count > MAX_SCAN_FILES) {
        degraded = true
        return
      }
      try {
        const info = await stat(absolute)
        snapshot.set(relativize(absolute, workspace), { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, sha256: undefined })
      } catch {
        /* a disappearing file is not an error */
      }
    }
  }
  await walk(workspace)
  return { snapshot, count, degraded }
}

async function readSteps(workspace, sessionId) {
  const base = join(workspace, PROVENANCE_DIR)
  const sessions = sessionId === undefined ? await listSessions(base) : [safeId(sessionId)]
  const steps = []
  for (const session of sessions) {
    const file = join(base, session, 'steps.jsonl')
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    let line = 0
    for (const raw of text.split('\n')) {
      line += 1
      const trimmed = raw.trim()
      if (trimmed.length === 0) continue
      try {
        steps.push({ step: JSON.parse(trimmed), session, line })
      } catch {
        steps.push({ step: null, session, line, corrupt: true })
      }
    }
  }
  return steps
}

async function listSessions(base) {
  try {
    const entries = await readdir(base, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch {
    return []
  }
}

function environment() {
  let python
  try {
    python = process.env.PYTHON_VERSION ?? undefined
  } catch {
    python = undefined
  }
  return { node: process.version, python: python ?? null, cwd: process.cwd() }
}

/** File version index: path -> the latest step that wrote it. */
function outputIndex(steps) {
  const index = new Map()
  for (const entry of steps) {
    if (entry.step === null) continue
    for (const edge of entry.step.outputs ?? []) {
      if (typeof edge?.path !== 'string') continue
      const previous = index.get(edge.path)
      if (previous === undefined || String(entry.step.timestamp) > String(previous.step.timestamp)) {
        index.set(edge.path, entry)
      }
    }
  }
  return index
}

async function walkLineage(workspace, target, { maxHops, maxNodes }) {
  const steps = await readSteps(workspace)
  const index = outputIndex(steps)
  const relTarget = relativize(isAbsolute(target) ? target : resolve(workspace, target), workspace)
  const visitedPaths = new Set()
  const nodes = []
  const queue = [{ path: relTarget, depth: 0 }]
  let truncated = false
  let complete = true

  while (queue.length > 0) {
    const current = queue.shift()
    if (visitedPaths.has(current.path)) continue
    if (current.depth > maxHops) {
      truncated = true
      complete = false
      continue
    }
    if (nodes.length >= maxNodes) {
      truncated = true
      complete = false
      break
    }
    visitedPaths.add(current.path)
    const producer = index.get(current.path)
    const node = { path: current.path, depth: current.depth, producedBy: null, inputs: [], previousSha256: null }
    if (producer === undefined) {
      complete = false
      nodes.push(node)
      continue
    }
    const step = producer.step
    node.producedBy = {
      id: step.id,
      toolName: step.toolName,
      timestamp: step.timestamp,
      sessionId: step.sessionId,
      runId: step.runId,
      fidelity: step.fidelity,
      isError: step.isError === true,
      outputSha256: (step.outputs ?? []).find((edge) => edge?.path === current.path)?.sha256 ?? null,
    }
    for (const input of step.inputs ?? []) {
      if (typeof input?.path !== 'string') continue
      // A previous version of the same path is history, not a parent node.
      if (input.path === current.path) {
        node.previousSha256 = input.sha256 ?? null
        continue
      }
      node.inputs.push({ path: input.path, sha256: input.sha256 ?? null, size: input.size ?? null, known: input.sha256 !== null && input.sha256 !== undefined })
      if (!visitedPaths.has(input.path)) queue.push({ path: input.path, depth: current.depth + 1 })
    }
    nodes.push(node)
  }

  return { path: relTarget, nodes, complete, truncated, stepsConsidered: steps.length }
}

/** Shared by the tool and the HTTP route. */
async function lineageReport(workspace, target, options = {}) {
  const maxHops = Number.isFinite(options.maxHops) ? Math.max(1, Math.min(24, Math.trunc(options.maxHops))) : 12
  const maxNodes = Number.isFinite(options.maxNodes) ? Math.max(1, Math.min(200, Math.trunc(options.maxNodes))) : 60
  const started = Date.now()
  try {
    const lineage = await walkLineage(workspace, target, { maxHops, maxNodes })
    return { ok: true, ...lineage, maxHops, maxNodes, ms: Date.now() - started }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

export function apply(ctx, config) {
  /** workspace -> Map(relPath -> {size, mtimeMs, sha256}) */
  const snapshots = new Map()
  /** callId -> {toolName, at} from session/event, so startedAt is real. */
  const callMeta = new Map()
  /** agentId -> ModelSelection captured at step admission (the only place it is known). */
  const stepModels = new Map()
  const pendingScan = new Set()
  /**
   * A bash step needs the state BEFORE the command runs. The first pass after a
   * restart used to compare with a snapshot taken after the command, so a fresh
   * host reported `outputs: []` for the first write. The call event is the only
   * hook that fires before execution, so the scan starts there and the step
   * awaits its promise.
   */
  const preScans = new Map()
  const degradedWorkspaces = new Set()

  /**
   * Identity of the session behind a tool call: subagent or lead, which model
   * ran the step, and the parent session for delegated work.
   *
   * A step is not attributable from the tool name alone — the same `bash` in a
   * subagent and in the lead is a different actor in the research record.
   */
  function sessionIdentity(exec) {
    const agentId = exec?.agent?.id
    if (agentId === undefined) return { role: 'lead', model: configModel(config) }
    let header
    try {
      const store = getService(ctx, 'sessions')
      header = store?.get?.(agentId)?.header
    } catch {
      header = undefined
    }
    const depth = typeof header?.delegationDepth === 'number' ? header.delegationDepth : 0
    const role = header?.origin === 'subagent' || depth > 0 ? 'subagent' : 'lead'
    const selection = stepModels.get(agentId)
    const model = selection !== undefined ? `${String(selection.provider ?? '?')}/${String(selection.model ?? '?')}` : configModel(config)
    const identity = { role, model }
    if (header?.parentSession !== undefined) identity.parentSession = String(header.parentSession)
    if (header?.agentPreset !== undefined) identity.agentPreset = String(header.agentPreset)
    if (depth > 0) identity.delegationDepth = depth
    return identity
  }

  function configModel(config) {
    return typeof config?.model === 'string' ? config.model : null
  }

  function workspaceFor(exec) {
    return resolveWorkspace(ctx, exec, config)
  }

  function snapshotOf(workspace) {
    let snapshot = snapshots.get(workspace)
    if (snapshot === undefined) {
      snapshot = new Map()
      snapshots.set(workspace, snapshot)
    }
    return snapshot
  }

  async function ensureSnapshot(workspace) {
    const existing = snapshots.get(workspace)
    if (existing !== undefined) return existing
    const { snapshot, degraded } = await scanWorkspace(workspace)
    snapshots.set(workspace, snapshot)
    if (degraded) degradedWorkspaces.add(workspace)
    return snapshot
  }

  // Durable events: remember when a call started, and tolerate a missing result.
  if (typeof ctx.on === 'function') {
    // Step admission is the only place the model selection is exposed
    // (`agent/pre-step` payload); tool execution carries no model, so record it here.
    ctx.on('agent/pre-step', (payload, next) => {
      try {
        const agentId = payload?.agent?.id
        if (typeof agentId === 'string' && payload?.modelSelection !== undefined) {
          stepModels.set(agentId, payload.modelSelection)
          if (stepModels.size > 200) {
            const oldest = stepModels.keys().next().value
            stepModels.delete(oldest)
          }
        }
      } catch {
        /* attribution is best-effort; the step still records without it */
      }
      return typeof next === 'function' ? next() : undefined
    })
    ctx.on('session/event', (session, event) => {
      try {
        const type = event?.type
        if (type !== 'tool/call') return
        const callId = event?.data?.callId ?? event?.callId
        const toolName = event?.data?.toolName ?? event?.toolName
        if (typeof callId !== 'string' || callId.length === 0) return
        callMeta.set(callId, { toolName: String(toolName ?? 'unknown'), at: event?.timestamp ?? new Date().toISOString() })
        if (String(toolName ?? '') === 'bash') {
          const owner = typeof session?.header?.id === 'string' ? session.header.id : undefined
          void (async () => {
            try {
              const { cwd } = await resolveWorkspace(ctx, owner === undefined ? undefined : { agent: { id: owner } }, config)
              if (!preScans.has(cwd)) preScans.set(cwd, scanWorkspace(cwd))
            } catch {
              /* the step falls back to the current snapshot */
            }
          })()
        }
        if (callMeta.size > 5000) {
          const oldest = callMeta.keys().next().value
          callMeta.delete(oldest)
        }
      } catch {
        /* observation must never break the host */
      }
      void session
    })

    ctx.on('tools/result', async (exec, result) => {
      try {
        await recordStep(exec, result)
      } catch (error) {
        /* A provenance write failure must not fail the tool call, but it must
           leave a trace: silence here hid a real ReferenceError for an hour. */
        reportStepFailure(error)
      }
    })
  }

  /** Once-per-message warning: a broken journal step is visible in the host log. */
const reportedStepFailures = new Set()
function reportStepFailure(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (reportedStepFailures.has(message)) return
  reportedStepFailures.add(message)
  console.warn(`[research-record] provenance step was not recorded: ${message}`)
}

async function recordStep(exec, result) {
    const toolName = String(exec?.name ?? 'unknown')
    const callId = String(exec?.callId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const sessionRaw = exec?.agent?.id ?? 'global'
    const sessionId = safeId(sessionRaw)
    const { cwd: workspace } = await workspaceFor(exec)
    const args = exec?.arguments ?? {}
    const isError = result?.isError === true
    const meta = callMeta.get(callId)
    callMeta.delete(callId)
    const timestamp = new Date().toISOString()
    const startedAt = meta?.at ?? timestamp

    const inputs = []
    const outputs = []
    let fidelity = 'observed'
    let degraded = false
    const notes = []

    const snapshot = await ensureSnapshot(workspace)
    if (degradedWorkspaces.has(workspace)) {
      fidelity = 'inferred'
      degraded = true
      notes.push(`workspace above ${MAX_SCAN_FILES} files: mtime-only detection`)
    }

    const pushInput = async (pathValue) => {
      if (inputs.length + outputs.length >= MAX_EDGES) return
      const known = snapshot.get(relativize(pathValue, workspace))?.sha256
      const edge = await edgeFor(workspace, pathValue, known)
      if (edge.sha256 === null && edge.status === 'missing') return
      inputs.push({ path: edge.path, sha256: edge.sha256, size: edge.size })
    }

    if (WRITE_TOOLS.has(toolName)) {
      const target = typeof args?.file_path === 'string' ? args.file_path : typeof args?.path === 'string' ? args.path : undefined
      if (target !== undefined) {
        const rel = relativize(target, workspace)
        const known = snapshot.get(rel)?.sha256
        if (toolName === 'edit' && typeof known === 'string') {
          const before = await edgeFor(workspace, rel, null)
          if (before.status !== 'missing') inputs.push({ path: before.path, sha256: known, size: before.size })
        }
        if (isError) {
          // The write failed: hashing the file now would report the OLD content as
          // this step's output, which is worse than recording no edge at all.
          notes.push(`write failed; ${rel} was not recorded as an output`)
        } else {
          const edge = await edgeFor(workspace, rel, null)
          if (edge.status !== 'missing' && edge.status !== 'unreadable') {
            outputs.push({ path: edge.path, sha256: edge.sha256, size: edge.size })
            if (edge.sha256 !== 'unhashed' && typeof edge.sha256 === 'string') {
              const entry = snapshot.get(edge.path) ?? { size: edge.size, mtimeMs: Date.now() }
              entry.sha256 = edge.sha256
              entry.size = edge.size
              entry.mtimeMs = Date.now()
              snapshot.set(edge.path, entry)
            }
          } else {
            notes.push(`output ${rel} ${edge.status}`)
          }
        }
      }
    } else if (toolName === 'bash') {
      const command = typeof args?.command === 'string' ? args.command : ''
      let before = new Map(snapshot)
      const preScan = preScans.get(workspace)
      if (preScan !== undefined) {
        preScans.delete(workspace)
        try {
          const scanned = await preScan
          before = new Map(scanned.snapshot)
          if (scanned.degraded === true && fidelity === 'observed') {
            fidelity = 'inferred'
            notes.push('the pre-command scan was degraded: mtime-only detection')
          }
        } catch {
          /* fall back to the snapshot we already have */
        }
      }
      for (const token of bashPathTokens(command)) await pushInput(token)
      if (pendingScan.has(workspace)) {
        fidelity = 'inferred'
        notes.push('a previous scan is still running; outputs not observed')
      } else {
        pendingScan.add(workspace)
        try {
          const { snapshot: after, degraded: scanDegraded } = await scanWorkspace(workspace)
          degraded = scanDegraded === true
          if (degraded) {
            fidelity = 'inferred'
            notes.push(`workspace above ${MAX_SCAN_FILES} files: mtime-only detection`)
          }
          const startedAtMs = Date.parse(startedAt)
          for (const [path, info] of after) {
            const previous = before.get(path)
            const unchanged =
              previous !== undefined &&
              previous.size === info.size &&
              previous.mtimeMs === info.mtimeMs &&
              (previous.ctimeMs === undefined || info.ctimeMs === undefined || previous.ctimeMs === info.ctimeMs)
            // A file whose mtime is at or after the moment the call was announced
            // was written by this call even when the pre-scan already saw it: the
            // scan is asynchronous, so a fast command can finish inside its window
            // and then `unchanged` would hide the only evidence we have. The slack
            // absorbs the difference between an ISO millisecond stamp and the
            // sub-millisecond mtime a filesystem actually stores.
            const touchedDuringCall =
              Number.isFinite(startedAtMs) && info.mtimeMs >= startedAtMs - CLOCK_SLACK_MS
            if (unchanged && !touchedDuringCall) continue
            if (outputs.length + inputs.length >= MAX_EDGES) {
              fidelity = 'inferred'
              notes.push(`edge limit ${MAX_EDGES} reached; the rest of this step is truncated`)
              break
            }
            if (info.size > MAX_HASH_BYTES) {
              outputs.push({ path, sha256: 'unhashed', size: info.size })
              snapshot.set(path, { ...info, sha256: 'unhashed' })
              continue
            }
            let sha256
            try {
              sha256 = await sha256File(isAbsolute(path) ? path : join(workspace, path))
            } catch {
              sha256 = null
            }
            if (sha256 === null) continue
            outputs.push({ path, sha256, size: info.size })
            snapshot.set(path, { size: info.size, mtimeMs: info.mtimeMs, sha256 })
          }
          for (const path of before.keys()) {
            if (!after.has(path)) snapshot.delete(path)
          }
        } catch (error) {
          fidelity = 'inferred'
          notes.push(`workspace scan failed: ${String(error?.message ?? error)}`)
        } finally {
          pendingScan.delete(workspace)
        }
      }
    } else {
      for (const candidate of pathArgs(args, workspace)) {
        await pushInput(candidate)
      }
      if (inputs.length > 0) fidelity = 'observed'
    }

    const identity = sessionIdentity(exec)
    const step = {
      schemaVersion: SCHEMA_VERSION,
      id: callId,
      sessionId,
      runId: String(exec?.rootCallId ?? exec?.turnId ?? sessionId),
      startedAt,
      timestamp,
      toolName,
      args: cleanArgs(args, workspace),
      isError,
      model: identity.model,
      role: identity.role,
      inputs: inputs.slice(0, MAX_EDGES),
      outputs: outputs.slice(0, MAX_EDGES),
      fidelity,
      environment: environment(),
      notes: notes.length > 0 ? notes : undefined,
    }
    if (identity.parentSession !== undefined) step.parentSession = identity.parentSession
    if (identity.agentPreset !== undefined) step.agentPreset = identity.agentPreset
    if (identity.delegationDepth !== undefined) step.delegationDepth = identity.delegationDepth

    const dir = join(workspace, PROVENANCE_DIR, sessionId)
    await mkdir(dir, { recursive: true })
    await appendLine(join(dir, 'steps.jsonl'), `${JSON.stringify(step)}\n`)

    // Files this step produced become visible to the journal, so "what did we
    // actually make" is answerable without reading steps.jsonl by hand.
    if (config?.autoNotes !== false && isError !== true && outputs.length > 0) {
      try {
        await appendAutoNote(workspace, {
          sessionId,
          toolName,
          stepId: callId,
          artifacts: outputs.filter((output) => output.sha256 !== null && output.sha256 !== undefined),
        })
      } catch (error) {
        reportStepFailure(error)
      }
    }
  }

  ctx.tools.register({
    name: 'provenance_of_file',
    description:
      'Walk the provenance graph upwards from a file: which step produced it (tool, time, sha256, observed/inferred), which inputs that step consumed, and so on (≤12 hops, ≤60 nodes, one version per path). Use it to answer "where did this number come from".',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File to explain (workspace-relative or absolute).' },
        maxHops: { type: 'number', description: 'Upward depth limit (default 12).' },
        maxNodes: { type: 'number', description: 'Node limit (default 60).' },
      },
      required: ['path'],
    },
    output: {
      schema: { type: 'object' },
      render(args, value) {
        if (value?.ok !== true) return [{ type: 'text', text: `provenance_of_file: ${value?.error ?? 'failed'}` }]
        const lines = [`lineage of ${value.path} (${value.nodes.length} node(s), ${value.stepsConsidered} step(s) scanned, ${value.ms} ms)`]
        if (value.nodes.length === 0) lines.push('no recorded step touched this path')
        for (const node of value.nodes) {
          const indent = '  '.repeat(node.depth)
          if (node.producedBy === null) {
            lines.push(`${indent}${node.path} ← (no producer recorded)`)
            continue
          }
          const producer = node.producedBy
          lines.push(
            `${indent}${node.path} ← ${producer.toolName} @ ${producer.timestamp} [${producer.fidelity}]${producer.outputSha256 ? ` sha256 ${String(producer.outputSha256).slice(0, 12)}` : ''}`,
          )
          if (node.previousSha256) lines.push(`${indent}   previous version: ${String(node.previousSha256).slice(0, 12)}`)
          for (const input of node.inputs) {
            lines.push(`${indent}   in: ${input.path}${input.sha256 ? ` ${String(input.sha256).slice(0, 12)}` : ' (unhashed)'}`)
          }
        }
        if (value.truncated) lines.push('walk truncated by hop/node limits — raise maxHops/maxNodes to see more')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const { cwd: workspace } = await workspaceFor(exec)
      const target = typeof args?.path === 'string' ? args.path : ''
      if (target.trim().length === 0) return { ok: false, error: 'path is required' }
      return lineageReport(workspace, target, { maxHops: args?.maxHops, maxNodes: args?.maxNodes })
    },
  })

  ctx.tools.register({
    name: 'provenance_verify',
    description:
      'Check the integrity of the provenance journal: every line parses, tool-call ids are unique, and timestamps do not go backwards. Fast (metadata only); pass checkFiles to also re-hash every recorded output against the disk.',
    parameters: {
      type: 'object',
      properties: {
        checkFiles: { type: 'boolean', description: 'Also re-hash recorded outputs and report files that changed or vanished.' },
        session: { type: 'string', description: 'Verify one session only (default: all sessions).' },
      },
    },
    output: {
      schema: { type: 'object' },
      render(args, value) {
        const lines = [
          `provenance_verify: ${value.ok ? 'OK' : 'FAILED'} — ${value.steps} step(s) in ${value.sessions.length} session(s), ${value.ms} ms`,
        ]
        for (const problem of value.problems.slice(0, 20)) lines.push(`  - ${problem}`)
        if (value.problems.length > 20) lines.push(`  … ${value.problems.length - 20} more`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const started = Date.now()
      const { cwd: workspace } = await workspaceFor(exec)
      const entries = await readSteps(workspace, typeof args?.session === 'string' ? args.session : undefined)
      const problems = []
      const ids = new Set()
      const sessions = new Set()
      // Timestamps are monotonic *within one session*: two sessions is not a
      // paradox, and comparing them was a false positive that failed every
      // parallel run.
      const previousBySession = new Map()
      let steps = 0
      // A later step that re-recorded the same path explains the change; only
      // the newest recorded version is compared with the disk.
      const lastProducer = new Map()
      entries.forEach((entry, position) => {
        if (entry.step === null) return
        for (const edge of entry.step.outputs ?? []) {
          if (typeof edge?.path === 'string') lastProducer.set(edge.path, position)
        }
      })
      for (const [position, entry] of entries.entries()) {
        if (entry.corrupt === true) {
          problems.push(`${entry.session}/steps.jsonl:${entry.line} is not valid JSON`)
          continue
        }
        const step = entry.step
        steps += 1
        sessions.add(entry.session)
        if (typeof step.id !== 'string' || step.id.length === 0) problems.push(`${entry.session}/steps.jsonl:${entry.line} has no id`)
        else if (ids.has(step.id)) problems.push(`duplicate step id ${step.id}`)
        else ids.add(step.id)
        if (typeof step.timestamp !== 'string') problems.push(`step ${step.id} has no timestamp`)
        else {
          const previousTimestamp = previousBySession.get(entry.session) ?? ''
          if (previousTimestamp !== '' && step.timestamp < previousTimestamp) {
            problems.push(`step ${step.id} goes back in time within session ${entry.session} (${step.timestamp} < ${previousTimestamp})`)
          }
          previousBySession.set(entry.session, step.timestamp)
        }
        if (args?.checkFiles === true) {
          for (const edge of step.outputs ?? []) {
            if (typeof edge?.path !== 'string' || edge.sha256 === 'unhashed' || edge.sha256 === null) continue
            if (lastProducer.get(edge.path) !== position) continue
            const absolute = isAbsolute(edge.path) ? edge.path : join(workspace, edge.path)
            try {
              const info = await stat(absolute)
              if (!info.isFile()) {
                problems.push(`output ${edge.path} is no longer a file`)
                continue
              }
              const current = await sha256File(absolute)
              if (current !== edge.sha256) problems.push(`output ${edge.path} changed since step ${step.id}`)
            } catch {
              problems.push(`output ${edge.path} is missing (recorded by step ${step.id})`)
            }
          }
        }
      }
      return { ok: problems.length === 0, steps, sessions: [...sessions].sort(), problems, ms: Date.now() - started }
    },
  })

  // The web panel needs the same walk; headless hosts simply do not have it.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.webServer.register({
        kind: 'exact',
        path: '/provenance',
        handler: async (req, res) => {
          try {
            const url = new URL(req.url ?? '/provenance', 'http://localhost')
            const target = url.searchParams.get('path') ?? ''
            const resolved = await panelWorkspace(ctx, url.searchParams.get('workspace'))
            if (resolved.ok !== true) {
              res.statusCode = 403
              res.setHeader('content-type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ ok: false, error: resolved.error }))
              return
            }
            const workspace = resolved.workspace
            if (target.length === 0) {
              res.statusCode = 400
              res.setHeader('content-type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ ok: false, error: 'path query parameter is required' }))
              return
            }
            const report = await lineageReport(workspace, target, {
              maxHops: Number(url.searchParams.get('maxHops') ?? undefined),
              maxNodes: Number(url.searchParams.get('maxNodes') ?? undefined),
            })
            res.statusCode = 200
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(report))
          } catch (error) {
            res.statusCode = 500
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
          }
        },
      })
    })
  }
}

export default { name, inject, apply }
