#!/usr/bin/env node
/**
 * smoke-cordis.mjs — the one suite that runs against the *real* cordis from the
 * installed DeepSeek Harness, not against a fake.
 *
 * Why: services in this bundle are not declared in `inject` (they must load on a
 * host without them), so in production every read goes through `ctx.get(name)`.
 * A plain object as `ctx` cannot show whether that works — cordis installs an
 * accessor that throws on a property read of a service the fiber did not inject.
 * This suite reproduces the host's semantics with real `Service` subclasses and
 * then asserts that the plugins still find the project directory.
 *
 *   node smoke-cordis.mjs                 # SKIP (exit 0) when cordis is absent
 *   DSH_CORDIS=/path/to/cordis/lib/index.js node smoke-cordis.mjs
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const checks = []
const failures = []
function check(label, condition, detail = '') {
  checks.push({ label, ok: condition === true })
  if (condition !== true) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`${condition === true ? 'PASS' : 'FAIL'}  ${label}${condition === true ? '' : `  ${detail}`}`)
}

const CANDIDATES = [
  process.env.DSH_CORDIS,
  '/home/claster/.npm/_npx/b86ed90107c62dab/node_modules/@deepseek-ai/cordis/lib/index.js',
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)

let cordis
for (const candidate of CANDIDATES) {
  if (!existsSync(candidate)) continue
  try {
    cordis = await import(pathToFileURL(candidate).href)
    break
  } catch {
    /* try the next candidate */
  }
}

if (cordis === undefined) {
  console.log('SKIP  cordis not found — set DSH_CORDIS to <checkout>/node_modules/@deepseek-ai/cordis/lib/index.js')
  process.exit(0)
}

const { Context, Service } = cordis

// ── the host, reproduced ──────────────────────────────────────────────────
const PROJECT_CWD = '/PROJECT_DIR'
const SESSION_CWD = '/SESSION_DIR'
const registered = new Map()

class WorkingDirectory extends Service {
  constructor(ctx) {
    super(ctx, 'workingDirectory', true)
  }
  async ensure() {
    return PROJECT_CWD
  }
}
class Sessions extends Service {
  constructor(ctx) {
    super(ctx, 'sessions', true)
  }
  get(id) {
    return { header: { id, cwd: SESSION_CWD } }
  }
}
class Tools extends Service {
  constructor(ctx) {
    super(ctx, 'tools', true)
  }
  register(definition) {
    if (registered.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`)
    registered.set(definition.name, definition)
    return () => registered.delete(definition.name)
  }
}
class SystemPrompt extends Service {
  constructor(ctx) {
    super(ctx, 'systemPrompt', true)
  }
  section() {
    return () => undefined
  }
}

const notebookModule = await import(join(here, 'notebook.js'))
const guardModule = await import(join(here, 'guard.js'))
const provenanceModule = await import(join(here, 'provenance.js'))

// 1. The semantics this suite exists for: a property read of a service that the
//    fiber did not inject must throw. If this regresses, the suite is worthless.
const semanticProbe = []
const probePlugin = {
  name: 'semantics-probe',
  inject: ['tools'],
  apply(ctx) {
    try {
      const value = ctx.workingDirectory
      semanticProbe.push(['prop', value === undefined ? 'undefined (no throw)' : 'resolved (no throw)'])
    } catch (error) {
      semanticProbe.push(['prop', `throws: ${error.message}`])
    }
    try {
      semanticProbe.push(['get', ctx.get('workingDirectory') ? 'resolved' : 'undefined'])
    } catch (error) {
      semanticProbe.push(['get', `throws: ${error.message}`])
    }
  },
}

const root = new Context()
await root.plugin(WorkingDirectory)
await root.plugin(Sessions)
await root.plugin(Tools)
await root.plugin(SystemPrompt)
await root.plugin(probePlugin)
await new Promise((done) => setTimeout(done, 50))

check(
  'property read of a non-injected service throws in real cordis',
  /throws/.test(semanticProbe.find((p) => p[0] === 'prop')?.[1] ?? ''),
  JSON.stringify(semanticProbe),
)
check(
  'ctx.get() reaches the same service without inject',
  semanticProbe.find((p) => p[0] === 'get')?.[1] === 'resolved',
  JSON.stringify(semanticProbe),
)

// 2. Our plugins, loaded by the real loader with their real inject lists.
const results = []
const consumer = {
  name: 'research-record-consumer',
  apply: async (ctx) => {
    const exec = { agent: { id: 'session-cordis-1' } }
    try {
      const resolved = await notebookModule.resolveWorkspace(ctx, exec, undefined)
      results.push(['resolveWorkspace', resolved?.cwd])
      results.push(['resolveWorkspace.source', resolved?.source])
    } catch (error) {
      results.push(['resolveWorkspace', `THROW: ${error.message}`])
    }
    try {
      const status = registered.get('policy_status')
      const value = status === undefined ? undefined : await status.execute({ limit: 1 }, { agent: { id: 'session-cordis-1' } })
      results.push(['policy_status.workspace', value?.workspace])
    } catch (error) {
      results.push(['policy_status.workspace', `THROW: ${error.message}`])
    }
  },
}

await root.plugin(notebookModule)
await root.plugin(guardModule)
await root.plugin(provenanceModule)
await root.plugin(consumer)
await new Promise((done) => setTimeout(done, 100))

const workspace = results.find((r) => r[0] === 'resolveWorkspace')?.[1]
check('resolveWorkspace returns the harness directory on real cordis', workspace === PROJECT_CWD, String(workspace))
const source = results.find((r) => r[0] === 'resolveWorkspace.source')?.[1]
check('resolveWorkspace takes it from workingDirectory, not a fallback', source === 'workingDirectory', String(source))

const policyWorkspace = results.find((r) => r[0] === 'policy_status.workspace')?.[1]
check('policy_status reports the harness directory, not process.cwd()', policyWorkspace === PROJECT_CWD, String(policyWorkspace))

check(
  'every plugin registered its tools on the real loader',
  registered.has('notebook') && registered.has('notebook_verify') && registered.has('policy_status') && registered.has('provenance_of_file'),
  [...registered.keys()].join(','),
)

try {
  await root.fiber.dispose()
} catch {
  /* teardown is best effort */
}

console.log(`${failures.length === 0 ? 'PASS' : 'FAIL'}  ${checks.length - failures.length}/${checks.length} on real cordis`)
process.exit(failures.length === 0 ? 0 : 1)
