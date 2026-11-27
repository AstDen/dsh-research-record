/**
 * dsh-research-record — guard: protected workspace paths and destructive commands.
 *
 * Policy lives in `<workspace>/.dsh/policy.json`:
 *
 *   {
 *     "protectedPaths": ["user_data/**", "data/**"],
 *     "destructiveConfirm": true
 *   }
 *
 * `protectedPaths` holds workspace-relative globs (`*` = one segment,
 * `**` = any depth). A glob that names a directory also covers everything
 * beneath it. An empty list means the guard stays silent.
 *
 * On `tools/pre-execute` (a waterfall):
 *   - `write` / `edit` targeting a protected path          -> deny + advice to
 *     work in a copy under `derived/`;
 *   - `bash` whose command mutates a protected path        -> deny, same advice;
 *   - a destructive command (`rm -rf`, `git clean -f`,
 *     `git reset --hard`, `find … -delete`, `dd`, `shred`)
 *     with `destructiveConfirm: true`                      -> ask.
 *
 * The tool arguments themselves are never rewritten: the guard only decides.
 * Every deny/ask is appended to `<workspace>/.dsh/guard/blocked.jsonl` and
 * summarised by the `policy_status` tool.
 *
 * Plugin row config overrides the file defaults:
 *   { protectedPaths: [...], destructiveConfirm: true }
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { getService } from './services.js'

export const name = 'research-record-guard'
export const inject = ['tools']

/** Defaults used when `.dsh/policy.json` is absent or silent. */
// Defaults match the brief: input directories are protected, destructive shell
// commands confirm. A policy.json in the workspace replaces the globs wholesale.
const DEFAULT_POLICY = {
  protectedPaths: ['user_data/**', 'data/**'],
  // The one thing the protection must not stop: deriving. The scaffold's own
  // AGENTS.md tells the model to work on copies in data/derived/.
  allowPaths: ['derived/**', 'data/derived/**', '**/derived/**'],
  destructiveConfirm: true,
}

/** A destructive shell fragment worth a confirmation, per the brief. */
const DESTRUCTIVE = [
  { id: 'rm-recursive-force', re: /\brm\s+(?:-[a-zA-Z]*\s+)*-{0,2}[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*/ },
  { id: 'rm-recursive-force', re: /\brm\s+(?:-[a-zA-Z]*\s+)*-{0,2}[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*/ },
  { id: 'git-clean-force', re: /\bgit\s+clean\s+-[a-zA-Z]*f/ },
  { id: 'git-reset-hard', re: /\bgit\s+reset\s+--hard\b/ },
  { id: 'find-delete', re: /\bfind\b[^\n]*\s-delete\b/ },
  { id: 'dd', re: /(^|[\s;&|(])dd\s/ },
  { id: 'shred', re: /(^|[\s;&|(])shred\s/ },
]

/**
 * Command names that write to every path argument they are given — a bare token
 * such as `user_data` is a destination for these, so flags are the only thing we
 * may skip. `rm -r -f user_data` must be refused, not classified.
 */
const WRITERS = /\b(rm|rmdir|mv|cp|mkdir|touch|truncate|chmod|chown|ln|tee|dd|shred|install|rsync|unzip|tar|cpio|patch)\b/

/**
 * Interpreters and in-place editors that READ their path arguments unless asked
 * to rewrite them. `sed -n 1p data/raw.csv` is a read; `sed -i …` is not.
 */
const IN_PLACE_TOOLS = /\b(sed|perl|ruby|python3?|node|php|awk)\b/
const IN_PLACE_FLAG = /(^|[\s;&|(])(-i|--in-place)([\s.=;|&)]|$)/

/** Extensions that make an otherwise bare token a plausible path. */
const PATHISH_EXT = /\.(csv|tsv|json|jsonl|md|txt|log|py|js|mjs|cjs|ts|sh|yaml|yml|toml|npy|npz|h5|hdf5|stl|vtk|dat|parquet|png|pdf|xlsx|zip|gz|tgz)$/i

/** Session-scoped counters, so `policy_status` can report the live session. */
const deniedBySession = new Map()
const askedBySession = new Map()

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

/**
 * The workspace of one agent: the session's creation directory, else the
 * harness process directory. Never throws — the guard must not fail closed on
 * a missing service.
 */
async function workspaceOf(ctx, exec) {
  const agentId = exec?.agent?.id
  // 1. The harness owns the answer: the service validates the directory and
  //    restores the original project if it disappeared. This is the same path
  //    the built-in fs/bash tools take.
  try {
    const service = getService(ctx, 'workingDirectory')
    if (exec?.agent !== undefined && typeof service?.ensure === 'function') {
      const cwd = await service.ensure(exec.agent, exec.signal)
      if (typeof cwd === 'string' && cwd.length > 0) return cwd
    }
  } catch {
    /* fall through to the session header */
  }
  // 2. The session header keeps the original project directory.
  try {
    const store = getService(ctx, 'sessions')
    const session = agentId === undefined ? undefined : store?.get?.(agentId)
    const cwd = session?.header?.cwd
    if (typeof cwd === 'string' && cwd.length > 0) return cwd
  } catch {
    /* no session store — fall back to the process directory */
  }
  return process.cwd()
}

async function loadPolicy(workspace, config) {
  const policy = {
    protectedPaths: Array.isArray(config?.protectedPaths) ? [...config.protectedPaths] : [...DEFAULT_POLICY.protectedPaths],
    allowPaths: Array.isArray(config?.allowPaths) ? [...config.allowPaths] : [...DEFAULT_POLICY.allowPaths],
    destructiveConfirm: config?.destructiveConfirm === undefined ? DEFAULT_POLICY.destructiveConfirm : config.destructiveConfirm !== false,
    path: join(workspace, '.dsh', 'policy.json'),
    found: false,
    error: undefined,
  }
  try {
    const text = await readFile(policy.path, 'utf8')
    const parsed = JSON.parse(text)
    policy.found = true
    if (Array.isArray(parsed?.protectedPaths)) policy.protectedPaths = parsed.protectedPaths.map(String).filter((entry) => entry.length > 0)
    if (Array.isArray(parsed?.allowPaths)) policy.allowPaths = parsed.allowPaths.map(String).filter((entry) => entry.length > 0)
    if (typeof parsed?.destructiveConfirm === 'boolean') policy.destructiveConfirm = parsed.destructiveConfirm
  } catch (error) {
    if (error?.code !== 'ENOENT') policy.error = String(error?.message ?? error)
  }
  policy.patterns = policy.protectedPaths.map((pattern) => ({ pattern, re: globToRegExp(pattern) }))
  policy.allowed = policy.allowPaths.map((pattern) => ({ pattern, re: globToRegExp(pattern) }))
  return policy
}

/**
 * Glob -> RegExp. `dir/**` covers the directory itself and its whole subtree;
 * a bare `*` stays inside one path segment, so `*.csv` does not match `a/b.csv`.
 */
function globToRegExp(glob) {
  const body = String(glob)
  if (body.endsWith('/**')) {
    const head = body
      .slice(0, -3)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
    return new RegExp(`^${head}(?:/.*)?$`)
  }
  const escaped = body
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${escaped}$`)
}

/** Path arguments of a write-like tool call. */
function pathArgs(args) {
  return [args?.file_path, args?.path, args?.target, args?.destination].filter((value) => typeof value === 'string' && value.length > 0)
}

/** Rough shell tokenizer: quoted runs stay whole, separators split. */
function tokens(command) {
  return command.match(/"[^"]*"|'[^']*'|`[^`]*`|[^\s;&|<>()]+/g) ?? []
}

function looksLikePath(token) {
  if (token.length === 0 || token.startsWith('-')) return false
  if (/^https?:\/\//i.test(token)) return false
  if (token.includes('/') || token.startsWith('.')) return true
  return PATHISH_EXT.test(token)
}

/** Path-shaped tokens a bash command could write to. */
export function bashCandidates(command) {
  const found = new Set()
  const add = (value) => {
    const cleaned = String(value).replace(/^["'`]|["'`]$/g, '')
    if (cleaned.length > 0 && !/^\/dev\//.test(cleaned)) found.add(cleaned)
  }
  // A redirect always writes, whatever the command is.
  for (const match of command.matchAll(/>>?\s*("[^"]*"|'[^']*'|[^\s;&|]+)/g)) add(match[1])
  const writers = WRITERS.test(command)
  const inPlace = IN_PLACE_TOOLS.test(command) && IN_PLACE_FLAG.test(command)
  if (writers || inPlace) {
    for (const token of tokens(command)) {
      // For a writer every non-flag argument is a destination, including a bare
      // name like `user_data`. For an in-place editor the same holds.
      if (token.startsWith('-')) continue
      if (/^[0-9]+$/.test(token)) continue
      if (looksLikePath(token) || writers) add(token)
    }
  }
  return [...found]
}

/** Which policy glob, if any, protects this candidate. */
function matchProtected(candidate, workspace, patterns, allowed = []) {
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(workspace, candidate)
  const rel = relative(workspace, absolute).replace(/\\/g, '/')
  const inside = !rel.startsWith('..') && !isAbsolute(rel)
  const subject = inside ? rel : absolute.replace(/\\/g, '/')
  const exemptions = allowed.filter((entry) => entry.re.test(subject) || entry.re.test(rel))
  if (exemptions.length > 0) return undefined
  for (const { pattern, re } of patterns) {
    if (re.test(subject) || re.test(rel.startsWith('..') ? '' : rel)) return { pattern, rel: subject }
  }
  return undefined
}

/** The first destructive pattern the command carries. */
function destructiveMatch(command) {
  for (const { id, re } of DESTRUCTIVE) if (re.test(command)) return id
  return undefined
}

/** Append one decision to the workspace audit log (best effort). */
async function recordBlocked(workspace, entry) {
  try {
    const file = join(workspace, '.dsh', 'guard', 'blocked.jsonl')
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    /* the audit log is evidence, not a gate */
  }
}

/** Read the audit log back, newest last; malformed lines are skipped. */
async function readBlocked(workspace) {
  try {
    const text = await readFile(join(workspace, '.dsh', 'guard', 'blocked.jsonl'), 'utf8')
    const entries = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      try {
        entries.push(JSON.parse(trimmed))
      } catch {
        /* a torn line does not invalidate the log */
      }
    }
    return entries
  } catch {
    return []
  }
}

const DENY_HINT = 'Protected inputs are read-only for tools. Work on a copy under derived/ (derive → analyse → record), never in place.'

export function apply(ctx, config) {
  ctx.on('tools/pre-execute', async (exec, next) => {
    const prior = typeof next === 'function' ? await next() : { kind: 'allow' }
    if (prior?.kind === 'deny' || prior?.kind === 'cancel') return prior

    const workspace = await workspaceOf(ctx, exec)
    const policy = await loadPolicy(workspace, config)
    if (policy.patterns.length === 0 && policy.destructiveConfirm !== true) return prior

    const toolName = String(exec?.name ?? '')
    const args = exec?.arguments ?? {}
    const sessionId = exec?.agent?.id ?? 'unknown'
    const callId = exec?.callId ?? 'unknown'

    if (toolName === 'write' || toolName === 'edit') {
      for (const candidate of pathArgs(args)) {
        const hit = matchProtected(candidate, workspace, policy.patterns, policy.allowed)
        if (hit === undefined) continue
        bump(deniedBySession, sessionId)
        const reason = `guard: "${hit.rel}" is protected by "${hit.pattern}" (.dsh/policy.json). ${DENY_HINT}`
        await recordBlocked(workspace, {
          at: new Date().toISOString(),
          sessionId,
          callId,
          tool: toolName,
          decision: 'deny',
          path: hit.rel,
          pattern: hit.pattern,
          reason,
        })
        return { kind: 'deny', reason, info: { code: 'protected_path', pattern: hit.pattern, path: hit.rel } }
      }
      return prior
    }

    if (toolName === 'bash') {
      const command = typeof args?.command === 'string' ? args.command : ''
      if (command.length === 0) return prior

      for (const candidate of bashCandidates(command)) {
        const hit = matchProtected(candidate, workspace, policy.patterns, policy.allowed)
        if (hit === undefined) continue
        bump(deniedBySession, sessionId)
        const reason = `guard: this command writes to "${hit.rel}", protected by "${hit.pattern}" (.dsh/policy.json). ${DENY_HINT}`
        await recordBlocked(workspace, {
          at: new Date().toISOString(),
          sessionId,
          callId,
          tool: toolName,
          decision: 'deny',
          path: hit.rel,
          pattern: hit.pattern,
          reason,
        })
        return { kind: 'deny', reason, info: { code: 'protected_path', pattern: hit.pattern, path: hit.rel } }
      }

      const destructive = destructiveMatch(command)
      if (destructive !== undefined && policy.destructiveConfirm === true) {
        bump(askedBySession, sessionId)
        const reason = `guard: "${destructive}" can destroy data irreversibly; confirm before it runs.`
        await recordBlocked(workspace, {
          at: new Date().toISOString(),
          sessionId,
          callId,
          tool: toolName,
          decision: 'ask',
          pattern: destructive,
          command: command.slice(0, 400),
          reason,
        })
        return {
          kind: 'ask',
          reason,
          displayReason: {
            en: `Allow a destructive command (${destructive})? It can erase data irreversibly.`,
            ru: `Разрешить разрушительную команду (${destructive})? Она может безвозвратно стереть данные.`,
          },
        }
      }
      return prior
    }

    return prior
  })

  const disposer = ctx.tools.register(
    {
      name: 'policy_status',
      description:
        'Show the active research-record guard policy for this workspace (protected globs, destructive-confirm) and what the guard denied or asked about.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many recent decisions to return (default 20).' },
        },
      },
      output: {
        schema: { type: 'object' },
        render(args, value) {
          const lines = [
            `workspace: ${value.workspace}`,
            `policy:    ${value.policyPath}${value.policyFound ? '' : ' (absent — defaults in use)'}`,
            `protected: ${value.protectedPaths.length === 0 ? '(none — guard silent)' : value.protectedPaths.join(', ')}`,
            `confirm:   destructiveConfirm=${String(value.destructiveConfirm)}`,
            `session:   denied=${value.session.denied} asked=${value.session.asked}`,
            `audit:     ${value.auditPath} (${value.total} entries)`,
          ]
          for (const entry of value.recent) {
            lines.push(`  ${entry.at} ${entry.decision} ${entry.tool} ${entry.path ?? entry.pattern ?? ''}`)
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args, exec) {
        const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(200, Math.trunc(args.limit))) : 20
        const workspace = await workspaceOf(ctx, exec)
        const policy = await loadPolicy(workspace, config)
        const entries = await readBlocked(workspace)
        const sessionId = exec?.agent?.id ?? 'unknown'
        return {
          workspace,
          policyPath: policy.path,
          policyFound: policy.found,
          protectedPaths: policy.protectedPaths,
          destructiveConfirm: policy.destructiveConfirm,
          policyError: policy.error ?? null,
          auditPath: join(workspace, '.dsh', 'guard', 'blocked.jsonl'),
          total: entries.length,
          session: { id: sessionId, denied: deniedBySession.get(sessionId) ?? 0, asked: askedBySession.get(sessionId) ?? 0 },
          recent: entries.slice(-limit).reverse(),
        }
      },
    },
  )
  void disposer
}

export default { name, inject, apply }
