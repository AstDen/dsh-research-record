/**
 * Usage telemetry for the research bundle.
 *
 * The point is not to watch the user: it is to answer, with numbers, the
 * questions a maintainer asks after a month of real use — which tools earn
 * their place, which fail, which stage of the research workflow is never
 * reached, and what a colleague's report proves that a single opinion cannot.
 *
 * What is recorded, per tool call: the tool name, success, duration, the
 * session (short hash), the role (lead/subagent), the model, the agent preset,
 * the argument *names* and total argument size, and — on failure — the first
 * line of the error with the user's absolute paths replaced. Argument values,
 * file contents, prompts and journal bodies are never recorded, so a report can
 * be sent to a maintainer without leaking the science.
 *
 * Storage: `<workspace>/.dsh/usage/events.jsonl` (append-only, rotated at
 * `maxFileBytes`), which keeps a project's usage next to its journal.
 */
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative } from 'node:path'

import { appendLine } from './lock.js'
import { activeWorkspace } from './notebook.js'
import { ROUTING } from './stack.js'
import { getService } from './services.js'

export const name = 'research-record-usage'
export const inject = ['tools', 'commands']

const USAGE_DIR = join('.dsh', 'usage')
const EVENTS_FILE = 'events.jsonl'
const MAX_ERROR_CHARS = 160
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024

/** Tools whose arguments are paths: keep the extension, drop the path. */
const PATH_KEYS = new Set(['file_path', 'path', 'pdf', 'stl', 'out', 'output', 'csv', 'xlsx', 'docx', 'pptx', 'tex', 'bib'])

/** Short, stable session id: enough to group calls, not enough to identify. */
export function shortSession(value) {
  const text = String(value ?? '')
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * The error message with the user's paths removed.
 *
 * A maintainer needs `ENOENT: /home/x/…/run-3/out.csv` as a shape, not the
 * researcher's home directory, so `/home/<user>` becomes `~` and the workspace
 * becomes `<workspace>`.
 */
export function sanitizeError(value, workspace) {
  let text = value instanceof Error ? `${value.name}: ${value.message}` : String(value ?? '')
  if (typeof workspace === 'string' && workspace.length > 0) {
    text = text.split(workspace).join('<workspace>')
  }
  text = text
    .replace(/\/home\/[^/\s]+/g, '~')
    .replace(/\/Users\/[^/\s]+/g, '~')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, '~')
    .replace(/[A-Za-z]:\\Documents and Settings\\[^\\\s]+/g, '~')
  text = text.replace(/\s+/g, ' ').trim()
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS - 1)}…` : text
}

/**
 * What the arguments looked like, without their contents.
 *
 * Names tell a maintainer which parameter the model reached for; sizes tell
 * whether a tool was called with a real document or with a stub; extensions
 * tell whether the tool is used on the file type it was written for.
 */
export function argSummary(args, workspace) {
  if (args === undefined || args === null || typeof args !== 'object') {
    return { keys: [], bytes: 0 }
  }
  const keys = Object.keys(args).sort()
  let bytes = 0
  try {
    bytes = Buffer.byteLength(JSON.stringify(args), 'utf8')
  } catch {
    bytes = 0
  }
  const summary = { keys, bytes }
  const extensions = []
  for (const key of keys) {
    if (!PATH_KEYS.has(key)) continue
    const value = args[key]
    if (typeof value !== 'string' || value.length === 0) continue
    const extension = extname(value).toLowerCase()
    if (extension.length > 0 && extension.length <= 8 && !extensions.includes(extension)) {
      extensions.push(extension)
    }
    void workspace
  }
  if (extensions.length > 0) summary.extensions = extensions.sort()
  return summary
}

/** The tools a routing row expects; explicit, because the second column is prose. */
export function routeTools(row) {
  if (!Array.isArray(row)) return []
  if (Array.isArray(row[2])) return [...row[2]]
  return []
}

export function parseEvents(text) {
  const events = []
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    try {
      const event = JSON.parse(line)
      if (event !== null && typeof event === 'object' && typeof event.tool === 'string') events.push(event)
    } catch {
      /* a torn line from a crash is not a reason to lose the rest */
    }
  }
  return events
}

function percentile(values, fraction) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))
  return sorted[index]
}

export function summarizeEvents(events, { days = 30, now = Date.now() } = {}) {
  const since = now - days * 24 * 60 * 60 * 1000
  const recent = events.filter((event) => {
    const at = Date.parse(String(event.ts ?? ''))
    return Number.isFinite(at) ? at >= since : true
  })
  const tools = new Map()
  const sessions = new Set()
  for (const event of recent) {
    const tool = event.tool
    let entry = tools.get(tool)
    if (entry === undefined) {
      entry = { tool, calls: 0, errors: 0, durations: [], last: '', errors_seen: new Map() }
      tools.set(tool, entry)
    }
    entry.calls += 1
    if (event.ok === false) {
      entry.errors += 1
      const message = String(event.error ?? 'unknown error')
      entry.errors_seen.set(message, (entry.errors_seen.get(message) ?? 0) + 1)
    }
    if (typeof event.ms === 'number' && Number.isFinite(event.ms)) entry.durations.push(event.ms)
    if (typeof event.ts === 'string' && event.ts > entry.last) entry.last = event.ts
    if (typeof event.session === 'string') sessions.add(event.session)
  }
  const rows = [...tools.values()]
    .map((entry) => ({
      tool: entry.tool,
      calls: entry.calls,
      errors: entry.errors,
      errorRate: entry.calls === 0 ? 0 : entry.errors / entry.calls,
      p50: Math.round(percentile(entry.durations, 0.5)),
      p95: Math.round(percentile(entry.durations, 0.95)),
      last: entry.last,
      topError: [...entry.errors_seen.entries()].sort((left, right) => right[1] - left[1])[0]?.[0],
    }))
    .sort((left, right) => right.calls - left.calls)
  const calls = rows.reduce((sum, row) => sum + row.calls, 0)
  const errors = rows.reduce((sum, row) => sum + row.errors, 0)
  return {
    days,
    since: new Date(since).toISOString(),
    calls,
    errors,
    errorRate: calls === 0 ? 0 : errors / calls,
    sessions: sessions.size,
    tools: rows,
    toolsUsed: rows.length,
    unusedRoutes: ROUTING.map((row) => ({ task: row[0], tools: routeTools(row) })).filter((route) => {
      if (route.tools.length === 0) return false
      return !route.tools.some((tool) => rows.some((row) => row.tool === tool))
    }),
  }
}

/** Record-type counts and honesty signals from the journal, for the funnel. */
export async function readJournalFunnel(workspace) {
  const directory = join(workspace, '.dsh', 'notebook')
  const counts = { hypothesis: 0, method: 0, observation: 0, decision: 0, note: 0, auto: 0, total: 0 }
  const outcomes = { signal: 0, null: 0, inconclusive: 0, 'technical-failure': 0 }
  let files = []
  try {
    files = (await readdir(directory)).filter((entry) => entry.endsWith('.jsonl'))
  } catch {
    return { counts, outcomes, files: 0, withArtifacts: 0 }
  }
  let withArtifacts = 0
  for (const file of files) {
    let text
    try {
      text = await readFile(join(directory, file), 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      let record
      try {
        record = JSON.parse(trimmed)
      } catch {
        if (file === 'supersede.jsonl') continue
        continue
      }
      if (record === null || typeof record !== 'object') continue
      const type = typeof record.type === 'string' ? record.type : 'unknown'
      if (type in counts) counts[type] += 1
      counts.total += 1
      if (record.auto === true) counts.auto += 1
      if (typeof record.outcome === 'string' && record.outcome in outcomes) outcomes[record.outcome] += 1
      if (Array.isArray(record.artifacts) && record.artifacts.length > 0) withArtifacts += 1
    }
  }
  return { counts, outcomes, files: files.length, withArtifacts }
}

/**
 * What the numbers suggest changing.
 *
 * Each suggestion names the evidence it came from, because a maintainer who
 * cannot see the evidence cannot decide whether to act — and a suggestion that
 * cannot be checked is a guess with a confident tone.
 */
export function suggestions(summary, funnel) {
  const lines = []
  const byTool = new Map(summary.tools.map((row) => [row.tool, row]))

  for (const row of summary.tools) {
    if (row.calls >= 3 && row.errorRate >= 0.2) {
      lines.push(
        `tool ${row.tool}: ${row.errors} of ${row.calls} calls failed ` +
        `(${Math.round(row.errorRate * 100)}%) — fix it or sharpen the description; ` +
        `most frequent text: ${row.topError ?? '—'}`,
      )
    }
  }

  const notebook = byTool.get('notebook')
  if ((notebook?.calls ?? 0) === 0 && summary.calls >= 20) {
    lines.push(
      `the journal is not kept: ${summary.calls} tool calls and not one notebook record — ` +
      'the journal discipline is not applied, the research-record skill is not loaded or is ignored',
    )
  }
  if (funnel.counts.hypothesis > 0 && funnel.counts.observation === 0) {
    lines.push(
      `hypotheses without observations: ${funnel.counts.hypothesis} hypothesis records and 0 observation — ` +
      'check whether runs get as far as recording a result',
    )
  }
  const check = byTool.get('figure_check')
  const spec = byTool.get('figure_spec')
  if ((check?.calls ?? 0) === 0 && (spec?.calls ?? 0) > 0) {
    lines.push(
      `figures are planned but never checked: figure_spec ${spec.calls} times, figure_check 0 — ` +
      'add the rule "saved a PDF → figure_check" to the matplotlib-figures skill',
    )
  }
  if (funnel.counts.auto > 0 && funnel.counts.auto * 3 > funnel.counts.total) {
    lines.push(
      `the journal is mostly automatic: ${funnel.counts.auto} of ${funnel.counts.total} records — ` +
      'auto notes do not replace method/observation, the model should be prompted to write them explicitly',
    )
  }
  for (const route of summary.unusedRoutes.slice(0, 6)) {
    lines.push(`route never used: ${route.task} (${route.tools.slice(0, 4).join(', ')}) — ` +
      'either it is not needed, or the tool is not in the set')
  }
  const single = summary.tools.filter((row) => row.calls === 1 && row.errors === 0)
  if (single.length > 0) {
    lines.push(
      `${single.length} tool(s) called exactly once (${single.slice(0, 5).map((row) => row.tool).join(', ')}) — ` +
      'often this means an unclear description rather than no task',
    )
  }
  if (lines.length === 0) {
    lines.push('nothing to fix is visible: few errors, the journal is kept, routes are used')
  }
  return lines
}

function formatMs(value) {
  if (value === 0) return '—'
  if (value < 1000) return `${value} ms`
  const seconds = value / 1000
  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds / 60)} min`
}

export function renderReport(summary, funnel, { workspace, routes = true } = {}) {
  const lines = []
  lines.push(`USAGE REPORT · ${basename(workspace ?? '')}`)
  lines.push(`period: last ${summary.days} d · calls ${summary.calls} · errors ${summary.errors} ` +
    `(${Math.round(summary.errorRate * 100)}%) · sessions ${summary.sessions} · tools ${summary.toolsUsed}`)
  lines.push('')
  lines.push('TOOLS (calls · errors · median · last seen)')
  if (summary.tools.length === 0) {
    lines.push('  no data yet: not one call in the period')
  }
  const width = Math.max(16, ...summary.tools.map((row) => row.tool.length))
  for (const row of summary.tools) {
    const rate = row.calls === 0 ? 0 : row.errorRate
    const flag = rate >= 0.2 ? ' ⚠' : ''
    lines.push(`  ${row.tool.padEnd(width)}  ${String(row.calls).padStart(4)}  ${String(row.errors).padStart(3)}  ` +
      `${formatMs(row.p50).padStart(7)}  ${row.last.slice(0, 16).replace('T', ' ')}${flag}`)
  }
  lines.push('')
  lines.push('JOURNAL (the research funnel)')
  lines.push(`  hypothesis ${funnel.counts.hypothesis} · method ${funnel.counts.method} · ` +
    `observation ${funnel.counts.observation} · decision ${funnel.counts.decision} · note ${funnel.counts.note}`)
  lines.push(`  of them automatic ${funnel.counts.auto} · records with artifacts ${funnel.withArtifacts} · ` +
    `signal ${funnel.outcomes.signal}/null ${funnel.outcomes.null}/inconclusive ${funnel.outcomes.inconclusive}/` +
    `technical-failure ${funnel.outcomes['technical-failure']}`)
  lines.push('')
  if (routes) {
    lines.push('WHAT IS SUGGESTED TO CHANGE')
    for (const line of suggestions(summary, funnel)) lines.push(`  · ${line}`)
    lines.push('')
  }
  lines.push('WHAT THIS REPORT DOES NOT CONTAIN (and will not): argument values, file contents, prompt')
  lines.push('text and journal records. Only tool names, argument names, sizes and errors.')
  return lines.join('\n')
}

async function readEventsFile(file) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
}

async function usagePath(workspace) {
  const directory = join(workspace, USAGE_DIR)
  await mkdir(directory, { recursive: true })
  return { directory, file: join(directory, EVENTS_FILE) }
}

export function apply(ctx, config) {
  const callMeta = new Map()
  const stepModels = new Map()
  let writeBudget = 0
  let lastRotateCheck = 0
  const enabled = config?.enabled !== false
  const recordAllTools = config?.recordAllTools !== false
  const maxFileBytes = typeof config?.maxFileBytes === 'number' ? config.maxFileBytes : DEFAULT_MAX_FILE_BYTES

  function modelFor(agentId) {
    const selection = stepModels.get(agentId)
    if (selection === undefined) return typeof config?.model === 'string' ? config.model : null
    return `${String(selection.provider ?? '?')}/${String(selection.model ?? '?')}`
  }

  function identity(exec) {
    const agentId = exec?.agent?.id
    if (agentId === undefined) return { role: 'lead', model: modelFor(undefined) }
    let header
    try {
      const store = getService(ctx, 'sessions')
      header = store?.get?.(agentId)?.header
    } catch {
      header = undefined
    }
    const depth = typeof header?.delegationDepth === 'number' ? header.delegationDepth : 0
    return {
      role: header?.origin === 'subagent' || depth > 0 ? 'subagent' : 'lead',
      model: modelFor(agentId),
      preset: header?.agentPreset,
      depth,
    }
  }

  async function rotateIfNeeded(file) {
    const now = Date.now()
    if (now - lastRotateCheck < 60_000) return
    lastRotateCheck = now
    try {
      const info = await stat(file)
      if (info.size < maxFileBytes) return
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      await rename(file, `${file}.${stamp}.bak`)
    } catch {
      /* no file yet, or a race with another writer: the append still works */
    }
  }

  async function record(exec, result) {
    if (!enabled) return
    const toolName = String(exec?.name ?? 'unknown')
    if (!recordAllTools && !toolName.startsWith('notebook') && !toolName.startsWith('figure')) return
    const workspace = await activeWorkspace(ctx, exec, config)
    const callId = String(exec?.callId ?? '')
    const meta = callMeta.get(callId)
    callMeta.delete(callId)
    const startedAt = typeof meta?.at === 'number' ? meta.at : Date.now()
    const who = identity(exec)
    const summary = argSummary(exec?.arguments, workspace)
    const event = {
      v: 1,
      ts: new Date().toISOString(),
      tool: toolName,
      ok: result?.isError !== true,
      ms: Math.max(0, Date.now() - startedAt),
      session: shortSession(exec?.agent?.id ?? 'global'),
      role: who.role,
      model: who.model,
    }
    if (typeof who.preset === 'string') event.preset = who.preset
    if (who.depth > 0) event.depth = who.depth
    if (summary.keys.length > 0) event.keys = summary.keys
    if (summary.bytes > 0) event.bytes = summary.bytes
    if (summary.extensions !== undefined) event.ext = summary.extensions
    if (event.ok === false) event.error = sanitizeError(result?.error ?? result?.message ?? 'tool returned isError', workspace)
    const { file } = await usagePath(workspace)
    await rotateIfNeeded(file)
    await appendLine(file, `${JSON.stringify(event)}\n`)
    writeBudget += 1
    if (writeBudget % 200 === 0 && callMeta.size > 4000) callMeta.clear()
  }

  if (typeof ctx.on === 'function') {
    ctx.on('agent/pre-step', (payload, next) => {
      try {
        const agentId = payload?.agent?.id
        if (typeof agentId === 'string' && payload?.modelSelection !== undefined) {
          stepModels.set(agentId, payload.modelSelection)
          if (stepModels.size > 200) stepModels.delete(stepModels.keys().next().value)
        }
      } catch {
        /* attribution is best-effort */
      }
      return typeof next === 'function' ? next() : undefined
    })
    ctx.on('session/event', (session, event) => {
      try {
        if (event?.type !== 'tool/call') return
        const callId = event?.data?.callId ?? event?.callId
        if (typeof callId !== 'string' || callId.length === 0) return
        const at = Date.parse(String(event?.timestamp ?? ''))
        callMeta.set(callId, { at: Number.isFinite(at) ? at : Date.now() })
        if (callMeta.size > 5000) callMeta.delete(callMeta.keys().next().value)
      } catch {
        /* a missing start time only costs one duration measurement */
      }
      void session
    })
    ctx.on('tools/result', async (exec, result) => {
      try {
        await record(exec, result)
      } catch (error) {
        /* Telemetry must never fail a tool call — but the failure is visible once. */
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        if (!reported.has(message)) {
          reported.add(message)
          console.warn(`[research-record] usage event was not recorded: ${message}`)
        }
      }
    })
  }

  async function reportFor(exec, { days = 30, routes = true } = {}) {
    const workspace = await activeWorkspace(ctx, exec, config)
    const { file } = await usagePath(workspace)
    const events = parseEvents(await readEventsFile(file))
    const summary = summarizeEvents(events, { days })
    const funnel = await readJournalFunnel(workspace)
    return { workspace, events, summary, funnel, text: renderReport(summary, funnel, { workspace, routes }) }
  }

  async function exportReport(exec, options) {
    const { workspace, summary, funnel, text } = await reportFor(exec, options)
    const directory = join(workspace, USAGE_DIR)
    await mkdir(directory, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const markdown = `${text}\n`
    const mdPath = join(directory, `report-${stamp}.md`)
    const jsonPath = join(directory, `report-${stamp}.json`)
    const [heading, ...body] = markdown.split('\n')
    await writeFile(mdPath, `# ${heading}\n${body.join('\n')}\n`)
    await writeFile(jsonPath, JSON.stringify({
      generated: new Date().toISOString(),
      workspace: basename(workspace),
      summary,
      funnel,
      suggestions: suggestions(summary, funnel),
      privacy: 'tool names, argument names, sizes and error shapes only',
    }, null, 2) + '\n')
    return { mdPath, jsonPath, text, summary }
  }

  ctx.tools.register({
    name: 'usage_report',
    description:
      'Report how this research bundle is actually used in the project: per-tool calls, error rate and ' +
      'latency, the journal funnel (hypothesis → method → observation → decision), unused workflow stages, ' +
      'and evidence-based suggestions for improving the plugin. Reads only tool metadata — never argument ' +
      'values, file contents or journal bodies. Use action "export" to write a Markdown + JSON report that ' +
      'can be sent to the maintainer.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['summary', 'export'], description: 'summary prints the report, export writes .md + .json into .dsh/usage/' },
        days: { type: 'integer', minimum: 1, maximum: 365, description: 'period in days (default 30)' },
        routes: { type: 'boolean', description: 'include the "what to change" section (default true)' },
      },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: value?.text ?? '' }],
    },
    async execute(args, exec) {
      const days = typeof args?.days === 'number' ? args.days : 30
      const routes = args?.routes !== false
      if (args?.action === 'export') {
        const result = await exportReport(exec, { days, routes })
        return {
          text: `${result.text}\n\nWritten:\n  ${result.mdPath}\n  ${result.jsonPath}\n` +
            'The report carries no argument values, file contents or journal records — it can be sent to a maintainer.',
          mdPath: result.mdPath,
          jsonPath: result.jsonPath,
          calls: result.summary.calls,
        }
      }
      const result = await reportFor(exec, { days, routes })
      return { text: result.text, calls: result.summary.calls, errors: result.summary.errors }
    },
  })

  const commands = getService(ctx, 'commands')
  if (typeof commands?.register === 'function') {
    commands.register({
      name: 'usage-report',
      description: 'Usage report for the plugin: tools, errors, journal funnel, what to improve',
      input: { hint: '[days|export]' },
      async handler(invocation) {
        const raw = String(invocation?.rawInput ?? '').trim()
        const exportRequested = /^export$|^экспорт$/i.test(raw)
        const days = Number.parseInt(raw, 10)
        const options = { days: Number.isFinite(days) && days > 0 ? days : 30, routes: true }
        const exec = { agent: invocation?.agent, signal: invocation?.signal }
        const result = exportRequested
          ? await exportReport(exec, options)
          : await reportFor(exec, options)
        const tail = exportRequested
          ? `\n\nWritten: ${result.mdPath}\n         ${result.jsonPath}`
          : ''
        return { kind: 'success', text: result.text + tail }
      },
    })
  }
}

const reported = new Set()

export default { name, inject, apply }
