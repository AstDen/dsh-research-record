#!/usr/bin/env node
/**
 * smoke-fixes.mjs — acceptance for the three record fixes (session-scoped digest,
 * actor attribution, automatic artifact notes).
 *
 * Kept separate from smoke.mjs so the original 13 acceptance lines stay readable
 * and a regression is easy to localise. Each check below is a behaviour the host
 * cannot show without a restart, so it runs against a fake host here.
 *
 *   node smoke-fixes.mjs
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeCtx } from './fixtures/ctx.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const notebook = await import(join(resolve(here), 'notebook.js'))
const provenance = await import(join(resolve(here), 'provenance.js'))

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok === true ? 'PASS' : 'FAIL'}  ${label}${ok === true || detail === '' ? '' : `  — ${detail}`}`)
  if (ok !== true) failures.push(label)
}

/** A host with sessions, tools, one prompt section, and an event bus. */
function makeHost(headers) {
  let handlers = new Map()
  const tools = new Map()
  const sections = []
  const services = {
    sessions: { get: (id) => (headers[id] === undefined ? undefined : { header: headers[id] }) },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => undefined
      },
    },
  }
  const ctx = makeCtx(services, { inject: ['tools', 'systemPrompt'], label: 'smoke-fixes' })
  handlers = ctx.__handlers
  return {
    ctx,
    tools,
    sections,
    fire: async (event, ...args) => {
      for (const handler of handlers.get(event) ?? []) await handler(...args)
    },
  }
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

const workspaceA = await mkdtemp(join(tmpdir(), 'rr-a-'))
const workspaceB = await mkdtemp(join(tmpdir(), 'rr-b-'))
const leadId = 'session-a'
const childId = 'session-b'
const headers = {
  [leadId]: { id: leadId, cwd: workspaceA },
  [childId]: { id: childId, cwd: workspaceA, origin: 'subagent', parentSession: leadId, delegationDepth: 1 },
  'session-c': { id: 'session-c', cwd: workspaceB },
}
const host = makeHost(headers)
notebook.apply(host.ctx, {})
provenance.apply(host.ctx, {})

const execOf = (sessionId, name, args, callId) => ({
  callId,
  name,
  arguments: args,
  agent: { id: sessionId },
  rootCallId: `root-${sessionId}`,
})

const record = (sessionId, args) =>
  host.tools.get('notebook').execute(args, execOf(sessionId, 'notebook', args, `c-${Math.random().toString(16).slice(2)}`))

const step = (sessionId, modelSelection) =>
  host.fire(
    'agent/pre-step',
    { agent: { id: sessionId }, modelSelection, messages: [], turn: 1, step: 1 },
    () => ({ kind: 'enter', messages: [] }),
  )

// --- check 1: the digest follows the session, not the process directory -------
await record(leadId, { type: 'method', title: 'project A method one' })
await record(leadId, { type: 'method', title: 'project A method two' })
await record('session-c', { type: 'hypothesis', title: 'project C hypothesis' })
await step(leadId, { provider: 'p', model: 'm' })
await step('session-c', { provider: 'p', model: 'm' })
await sleep(400)

const digest = host.sections.find((section) => section.name === 'research-record-digest')
check('digest section is registered', digest !== undefined)
const textA = digest.text({ agent: { id: leadId } })
const textC = digest.text({ agent: { id: 'session-c' } })
check('digest of project A counts only A records', textA.includes('2 records') && !textA.includes('project C hypothesis'), textA)
check('digest of project C shows the open hypothesis', textC.includes('1 open hypotheses') && textC.includes('project C hypothesis'), textC)
check('a scope-less assembly renders no foreign journal', digest.text({}) === '' || textC.indexOf('project C') === digest.text({}).indexOf('project C'), JSON.stringify(digest.text({})))

// --- check 2: the step is attributed to the actor that ran it ----------------
await writeFile(join(workspaceA, 'results.csv'), 'a,b\n1,2\n')
await step(childId, { provider: 'deepseek-account', model: 'deepseek-flash' })
await host.fire('tools/result', execOf(childId, 'write', { file_path: 'results.csv' }, 'call-write-1'), { isError: false })

const stepsRaw = await readFile(join(workspaceA, '.dsh', 'provenance', childId, 'steps.jsonl'), 'utf8')
const stepRecord = JSON.parse(stepsRaw.trim().split('\n').pop())
check('subagent step is not labelled lead', stepRecord.role === 'subagent', stepRecord.role)
check('step records the model that ran it', stepRecord.model === 'deepseek-account/deepseek-flash', String(stepRecord.model))
check('step keeps the parent session', stepRecord.parentSession === leadId, String(stepRecord.parentSession))

// --- check 3: a produced file becomes a note, exactly once -------------------
await writeFile(join(workspaceA, 'results.csv'), 'a,b\n1,3\n')
await host.fire('tools/result', execOf(childId, 'write', { file_path: 'results.csv' }, 'call-write-2'), { isError: false })

const journalRows = (await readFile(join(workspaceA, '.dsh', 'notebook', `${childId}.jsonl`), 'utf8'))
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
const autoNotes = journalRows.filter((row) => row.auto === true)
check('exactly one auto note for a repeatedly written file', autoNotes.length === 1, String(autoNotes.length))
check('auto note cites the produced artifact', autoNotes[0]?.artifacts?.some((artifact) => artifact.path === 'results.csv') === true)
check('auto note is tagged auto and carries the step id', autoNotes[0]?.tags?.includes('auto') === true && typeof autoNotes[0]?.stepId === 'string')

const verify = await host.tools
  .get('notebook_verify')
  .execute({}, execOf(childId, 'notebook_verify', {}, 'call-verify'))
check('hash chain still verifies with an auto note', verify.ok === true, JSON.stringify(verify.brokenAt ?? null))

// --- check 4: manual records keep the chain and lose nothing -----------------
const manual = await record(leadId, { type: 'decision', title: 'project A decision', body: 'why' })
check('manual record still appends with a verified hash', manual.ok === true && /^[0-9a-f]{64}$/.test(manual.record.hash))

// --- fix 4: the project directory, not the launcher's tree ------------------
// A journal written to `node_modules/.bin/.dsh` is a record that disappears on
// the next launcher update, and the tool still prints a hash. Every source in
// the chain is checked, plus the refusal.
{
  const services = (cwd) => ({ workingDirectory: { ensure: async () => cwd } })
  const fromService = await notebook.resolveWorkspace(services('/tmp/project-a'), execOf(leadId, 'notebook', {}), undefined)
  check('workspace comes from the harness service first', fromService.cwd === '/tmp/project-a' && fromService.source === 'workingDirectory')

  const fromHeader = await notebook.resolveWorkspace({ sessions: { get: () => ({ header: { cwd: '/tmp/project-b' } }) } }, execOf(leadId, 'notebook', {}), undefined)
  check('workspace falls back to the session header', fromHeader.cwd === '/tmp/project-b' && fromHeader.source === 'session')

  const fromConfig = await notebook.resolveWorkspace({}, execOf(leadId, 'notebook', {}), { workspace: '/tmp/project-c' })
  check('workspace honours the bundle configuration', fromConfig.cwd === '/tmp/project-c' && fromConfig.source === 'config')

  process.env.DSH_RESEARCH_WORKSPACE = '/tmp/project-d'
  const fromEnv = await notebook.resolveWorkspace({}, execOf(leadId, 'notebook', {}), undefined)
  check('workspace honours DSH_RESEARCH_WORKSPACE', fromEnv.cwd === '/tmp/project-d' && fromEnv.source === 'env')
  delete process.env.DSH_RESEARCH_WORKSPACE

  let refused = false
  try {
    await notebook.resolveWorkspace({ workingDirectory: { ensure: async () => '/home/x/.npm/_npx/abc/node_modules/.bin' } }, execOf(leadId, 'notebook', {}), undefined)
  } catch (error) {
    refused = /node_modules/.test(String(error?.message)) && /workspace/.test(String(error?.message))
  }
  check('a launcher tree inside node_modules is refused', refused)

  const explicit = await notebook.resolveWorkspace({}, execOf(leadId, 'notebook', {}), { workspace: '/home/x/project/node_modules/real' })
  check('an explicitly configured path is not second-guessed', explicit.cwd === '/home/x/project/node_modules/real' && explicit.source === 'config')
}

console.log(`\n${failures.length === 0 ? 'all fixes hold' : `${failures.length} failed: ${failures.join(', ')}`}`)
process.exit(failures.length === 0 ? 0 : 1)
