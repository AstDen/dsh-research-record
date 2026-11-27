#!/usr/bin/env node
/**
 * smoke.mjs — acceptance checks for dsh-research-record without a DSH host.
 *
 * A fake `ctx` implements the five services the plugins touch (`tools`,
 * `systemPrompt`, `on`, `sessions`, `get`). Every check below mirrors one line
 * of the brief's acceptance list, so a green run means the server-side gates
 * work before the bundle is installed.
 *
 *   node smoke.mjs            # run
 *   node smoke.mjs --keep     # keep the temp workspace for inspection
 */

import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const guardModule = await import(join(resolve(here), 'guard.js'))
const notebookModule = await import(join(resolve(here), 'notebook.js'))
const provenanceModule = await import(join(resolve(here), 'provenance.js'))

const failures = []
const checks = []
function check(label, condition, detail = '') {
  checks.push({ label, ok: condition === true, detail })
  if (condition !== true) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`${condition === true ? 'PASS' : 'FAIL'}  ${label}${condition === true ? '' : `  ${detail}`}`)
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

/** A host stand-in: services only, no UI, no web server. */
function makeHost(cwd, sessionId) {
  const tools = new Map()
  const sections = []
  const handlers = new Map()
  const ctx = {
    sessions: { get: (id) => (id === sessionId ? { header: { id, cwd } } : undefined) },
    get(name) {
      return name === 'sessions' ? ctx.sessions : undefined
    },
    tools: {
      register(definition) {
        if (tools.has(definition.name)) throw new Error(`duplicate tool registration: ${definition.name}`)
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
    on(event, handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return () => undefined
    },
    inject() {
      /* no webServer in the fake host */
    },
  }
  return { ctx, tools, sections, handlers }
}

const workspace = await mkdtemp(join(tmpdir(), 'research-record-smoke-'))
const sessionId = 'smoke-session-1'
const host = makeHost(workspace, sessionId)
guardModule.apply(host.ctx, undefined)
notebookModule.apply(host.ctx, undefined)
provenanceModule.apply(host.ctx, undefined)
process.chdir(workspace)

const tool = (name) => {
  const definition = host.tools.get(name)
  if (definition === undefined) throw new Error(`tool ${name} is not registered`)
  return definition
}
const execFor = (callId, name, args, extra = {}) => ({
  callId,
  name,
  arguments: args,
  agent: { id: sessionId },
  rootCallId: 'root-smoke',
  ...extra,
})
const run = (name, args, callId = `${name}-${Math.random().toString(16).slice(2)}`) => tool(name).execute(args, execFor(callId, name, args))

async function emit(event, session, payload) {
  const handlers = host.handlers.get(event) ?? []
  for (const handler of handlers) await handler(session, payload)
}

async function emitResult(exec, result = { isError: false, value: {} }) {
  const handlers = host.handlers.get('tools/result') ?? []
  for (const handler of handlers) await handler(exec, result)
}

console.log(`workspace: ${workspace}\n--- guard ---`)

await mkdir(join(workspace, '.dsh'), { recursive: true })
await writeFile(
  join(workspace, '.dsh', 'policy.json'),
  `${JSON.stringify({ protectedPaths: ['user_data/**', 'data/**'], destructiveConfirm: true }, null, 2)}\n`,
  'utf8',
)

const preExecute = (await host.handlers.get('tools/pre-execute'))[0]
const allow = async () => ({ kind: 'allow' })
const decide = (name, args) => preExecute(execFor(`guard-${name}`, name, args), allow)

const denyWrite = await decide('write', { file_path: 'user_data/raw.csv', content: 'x' })
check('guard: write into user_data/** is denied', denyWrite?.kind === 'deny', JSON.stringify(denyWrite))
check('guard: denial explains the protected glob and derived/', /protected/.test(denyWrite?.reason ?? '') && /derived\//.test(denyWrite?.reason ?? ''), denyWrite?.reason)

const allowWrite = await decide('write', { file_path: 'derived/out.csv', content: 'a,b\n1,2\n' })
check('guard: write into derived/ is allowed', allowWrite?.kind === 'allow', JSON.stringify(allowWrite))

const denyBash = await decide('bash', { command: 'cp derived/out.csv data/final.csv' })
check('guard: bash writing into data/** is denied', denyBash?.kind === 'deny', JSON.stringify(denyBash))

const askBash = await decide('bash', { command: 'rm -rf derived/tmp' })
check('guard: rm -rf asks for confirmation', askBash?.kind === 'ask', JSON.stringify(askBash))
check('guard: ask carries an English display reason', typeof askBash?.displayReason?.en === 'string', JSON.stringify(askBash?.displayReason))

const askGit = await decide('bash', { command: 'git reset --hard HEAD~1' })
check('guard: git reset --hard asks for confirmation', askGit?.kind === 'ask', JSON.stringify(askGit))

const plainBash = await decide('bash', { command: 'ls -la derived' })
check('guard: an ordinary command is allowed', plainBash?.kind === 'allow', JSON.stringify(plainBash))

const policy = await run('policy_status', {})
check('guard: policy_status reports the protected globs', Array.isArray(policy.protectedPaths) && policy.protectedPaths.includes('user_data/**'), JSON.stringify(policy.protectedPaths))
check('guard: policy_status reports denials for this session', policy.session.denied >= 2, JSON.stringify(policy.session))
check('guard: denials are appended to the audit log', policy.total >= 2, String(policy.total))

console.log('\n--- notebook ---')

const hypothesis = await run('notebook', { type: 'hypothesis', title: 'H1: throughput scales linearly with cores', body: 'Predicted from the queueing model.' })
check('notebook: hypothesis is accepted', hypothesis.ok === true && /^n_[0-9A-Z]{26}$/.test(hypothesis.record?.id ?? ''), JSON.stringify(hypothesis).slice(0, 200))
check('notebook: record carries a 64-hex hash', /^[0-9a-f]{64}$/.test(hypothesis.record?.hash ?? ''), hypothesis.record?.hash)
check('notebook: genesis record has a zero prevHash', hypothesis.record?.prevHash === '0'.repeat(64), hypothesis.record?.prevHash)

const completedNoEvidence = await run('notebook', {
  type: 'observation',
  title: 'Throughput measured without a log',
  execution: { state: 'completed' },
  outcome: 'signal',
})
check(
  'notebook: completed without evidence is downgraded to unverified',
  completedNoEvidence.record?.execution?.state === 'unverified',
  JSON.stringify(completedNoEvidence.record?.execution),
)
check('notebook: the downgrade is reported in warnings', Array.isArray(completedNoEvidence.warnings) && completedNoEvidence.warnings.some((w) => /unverified/.test(w)), JSON.stringify(completedNoEvidence.warnings))

await mkdir(join(workspace, 'derived'), { recursive: true })
await writeFile(join(workspace, 'derived', 'out.csv'), 'cores,throughput\n1,10\n4,40\n', 'utf8')
const withArtifact = await run('notebook', {
  type: 'observation',
  title: 'Throughput 40 units at 4 cores',
  body: 'Measured on gpu-box, 3 repeats, median reported.',
  artifacts: [{ path: 'derived/out.csv' }],
  execution: { state: 'completed', evidence: 'derived/out.csv' },
  outcome: 'signal',
  evidence: [{ entryId: hypothesis.record.id, relation: 'supports', rationale: 'matches the linear prediction' }],
  confidence: 'medium',
})
check('notebook: completed with evidence stays completed', withArtifact.record?.execution?.state === 'completed', JSON.stringify(withArtifact.record?.execution))
check('notebook: a real artifact gets a sha256', withArtifact.record?.artifacts?.[0]?.status === 'unchanged' && /^[0-9a-f]{64}$/.test(withArtifact.record?.artifacts?.[0]?.sha256 ?? ''), JSON.stringify(withArtifact.record?.artifacts))
check('notebook: valid evidence is kept', withArtifact.record?.evidence?.length === 1, JSON.stringify(withArtifact.record?.evidence))

const unknownEvidence = await run('notebook', {
  type: 'note',
  title: 'Note leaning on a record that does not exist',
  evidence: [{ entryId: 'n_00000000000000000000000000', relation: 'supports' }],
  supersedes: 'n_11111111111111111111111111',
  relatesTo: ['n_22222222222222222222222222'],
})
check('notebook: unknown evidence is dropped with a warning', unknownEvidence.record?.evidence?.length === 0 && unknownEvidence.warnings.length >= 1, JSON.stringify(unknownEvidence.warnings))
check('notebook: unknown supersedes is dropped', unknownEvidence.record?.supersedes === null, String(unknownEvidence.record?.supersedes))

const decisionWrongOutcome = await run('notebook', { type: 'decision', title: 'Decision with a stray outcome', outcome: 'signal' })
check('notebook: outcome on a decision is dropped with a warning', decisionWrongOutcome.record?.outcome === null, JSON.stringify(decisionWrongOutcome.warnings))

const missingArtifact = await run('notebook', { type: 'observation', title: 'Artifact that is not on disk', artifacts: [{ path: 'derived/nope.csv' }] })
check('notebook: missing artifact is marked missing', missingArtifact.record?.artifacts?.[0]?.status === 'missing', JSON.stringify(missingArtifact.record?.artifacts))

const superseding = await run('notebook', { type: 'decision', title: 'Decision: keep the linear model for now', supersedes: hypothesis.record.id, relatesTo: [hypothesis.record.id] })
check('notebook: supersedes is accepted for an existing record', superseding.record?.supersedes === hypothesis.record.id, String(superseding.record?.supersedes))

const readOld = await run('notebook_search', { action: 'read', id: hypothesis.record.id })
check('notebook: reading a superseded record shows supersededBy', readOld.record?.supersededBy === superseding.record.id, String(readOld.record?.supersededBy))

const readDigest = await run('notebook_search', { action: 'read', id: hypothesis.record.id, expectedDigest: hypothesis.record.hash })
check('notebook: read with the right digest succeeds', readDigest.ok === true, JSON.stringify(readDigest).slice(0, 160))
const readBadDigest = await run('notebook_search', { action: 'read', id: hypothesis.record.id, expectedDigest: 'f'.repeat(64) })
check('notebook: read with a wrong digest is refused', readBadDigest.ok === false && /mismatch/.test(readBadDigest.error ?? ''), JSON.stringify(readBadDigest))

const searchHit = await run('notebook_search', { query: 'throughput linear' })
check('notebook: lexical search finds the matching records', searchHit.ok === true && searchHit.results.length >= 1, JSON.stringify(searchHit.results?.map((r) => r.id)))

const filtered = await run('notebook_search', { query: '', type: 'decision' })
check('notebook: search filters by type', filtered.results.every((r) => r.type === 'decision'), JSON.stringify(filtered.results?.map((r) => r.type)))

const verifyClean = await run('notebook_verify', {})
check('notebook_verify: a fresh journal is ok', verifyClean.ok === true, JSON.stringify(verifyClean).slice(0, 200))
check('notebook_verify: counts every record', verifyClean.records === 7, String(verifyClean.records))

await unlink(join(workspace, 'derived', 'out.csv'))
const readMissing = await run('notebook_search', { action: 'read', id: withArtifact.record.id })
check('notebook: an artifact deleted after the fact reads as missing', readMissing.record?.artifacts?.[0]?.status === 'missing', JSON.stringify(readMissing.record?.artifacts))
await writeFile(join(workspace, 'derived', 'out.csv'), 'cores,throughput\n1,10\n4,40\n', 'utf8')

console.log('\n--- provenance ---')

const resultsFile = join(workspace, 'derived', 'results.csv')
const resultsText = 'cores,throughput\n1,10\n4,40\n'
await writeFile(resultsFile, resultsText, 'utf8')

await emit('session/event', { header: { id: sessionId } }, { type: 'tool/call', data: { callId: 'call-write-1', toolName: 'write' }, timestamp: new Date(Date.now() - 1200).toISOString() })
await emitResult(execFor('call-write-1', 'write', { file_path: resultsFile, content: resultsText }))

const lineageWrite = await run('provenance_of_file', { path: 'derived/results.csv' })
const producer = lineageWrite.nodes?.[0]?.producedBy
check('provenance_of_file: the writer step is found', lineageWrite.ok === true && producer?.toolName === 'write', JSON.stringify(lineageWrite).slice(0, 240))
check('provenance_of_file: the output sha256 is the file hash', producer?.outputSha256 === sha256(resultsText), String(producer?.outputSha256))
check('provenance_of_file: fidelity is observed', producer?.fidelity === 'observed', String(producer?.fidelity))
check('provenance_of_file: startedAt predates timestamp', typeof producer?.timestamp === 'string' && lineageWrite.nodes[0].depth === 0, JSON.stringify(producer))

const firstHash = sha256(resultsText)
const editedText = 'cores,throughput\n1,10\n2,20\n4,40\n'
await writeFile(resultsFile, editedText, 'utf8')
await emitResult(execFor('call-edit-1', 'edit', { file_path: resultsFile, old_string: '4,40', new_string: '2,20\n4,40' }))

const lineageEdit = await run('provenance_of_file', { path: 'derived/results.csv' })
const editNode = lineageEdit.nodes?.[0]
check('provenance_of_file: the latest version is the edit step', editNode?.producedBy?.toolName === 'edit', JSON.stringify(editNode?.producedBy))
check('provenance_of_file: the previous version hash is kept', editNode?.previousSha256 === firstHash, String(editNode?.previousSha256))
check('provenance_of_file: the current hash matches the edited file', editNode?.producedBy?.outputSha256 === sha256(editedText), String(editNode?.producedBy?.outputSha256))

const lineageRead = await run('provenance_of_file', { path: 'derived/out.csv' })
check('provenance_of_file: a file no step wrote reports no producer', lineageRead.ok === true && lineageRead.nodes?.[0]?.producedBy === null, JSON.stringify(lineageRead.nodes?.[0]))

const stepsFile = join(workspace, '.dsh', 'provenance', sessionId, 'steps.jsonl')
const stepsText = await readFile(stepsFile, 'utf8')
const steps = stepsText.trim().split('\n').map((line) => JSON.parse(line))
check('provenance: one line per observed tool call', steps.length === 2, String(steps.length))
check('provenance: arguments are workspace-relative', JSON.stringify(steps[0].args).includes('derived/results.csv') && !JSON.stringify(steps[0].args).includes(workspace), JSON.stringify(steps[0].args))
check('provenance: a step carries id, runId, environment', typeof steps[0].id === 'string' && typeof steps[0].runId === 'string' && typeof steps[0].environment?.node === 'string', JSON.stringify(steps[0]).slice(0, 200))

await emit('session/event', { header: { id: sessionId } }, { type: 'tool/call', data: { callId: 'call-bash-1', toolName: 'bash' } })
await writeFile(join(workspace, 'derived', 'from-bash.txt'), 'produced by a shell command\n', 'utf8')
await emitResult(execFor('call-bash-1', 'bash', { command: 'python3 make.py > derived/from-bash.txt' }))
const bashLineage = await run('provenance_of_file', { path: 'derived/from-bash.txt' })
check('provenance: a bash write is observed by the workspace scan', bashLineage.nodes?.[0]?.producedBy?.toolName === 'bash', JSON.stringify(bashLineage.nodes?.[0]))

// 100 more steps: verify must stay fast and green.
for (let index = 0; index < 100; index += 1) {
  await emitResult(execFor(`call-read-${index}`, 'read', { file_path: resultsFile }))
}
const verifyProvenance = await run('provenance_verify', {})
check('provenance_verify: 100+ steps verify ok', verifyProvenance.ok === true, JSON.stringify(verifyProvenance.problems?.slice(0, 3)))
check('provenance_verify: stays under 200 ms', verifyProvenance.ms < 200, `${verifyProvenance.ms} ms`)
check('provenance_verify: counts every step', verifyProvenance.steps === 103, String(verifyProvenance.steps))

const deepVerify = await run('provenance_verify', { checkFiles: true })
check('provenance_verify: checkFiles agrees with the disk', deepVerify.ok === true, JSON.stringify(deepVerify.problems?.slice(0, 3)))

console.log('\n--- prompt digest ---')
await new Promise((accept) => setTimeout(accept, 500))
const digestSection = host.sections.find((section) => section.name === 'research-record-digest')
const digestText = typeof digestSection?.text === 'function' ? digestSection.text() : String(digestSection?.text ?? '')
check('prompt: the digest section is registered', digestSection !== undefined, JSON.stringify(host.sections.map((s) => s.name)))
check('prompt: the digest mentions open hypotheses', /open hypotheses/.test(digestText), digestText.slice(0, 200))
check('prompt: the digest mentions unverified executions', /unverified/.test(digestText), digestText.slice(0, 400))

console.log('\n--- tamper detection (last: it breaks the journal) ---')
const journalFile = join(workspace, '.dsh', 'notebook', `${sessionId}.jsonl`)
const lines = (await readFile(journalFile, 'utf8')).trim().split('\n')
const tampered = JSON.parse(lines[1])
tampered.title = 'Throughput was actually 4000 units (edited by hand)'
lines[1] = JSON.stringify(tampered)
await writeFile(journalFile, `${lines.join('\n')}\n`, 'utf8')
const verifyBroken = await run('notebook_verify', {})
check('notebook_verify: a hand-edited line is caught', verifyBroken.ok === false, JSON.stringify(verifyBroken).slice(0, 240))
check('notebook_verify: the broken line is named', typeof verifyBroken.brokenAt?.line === 'number' && verifyBroken.brokenAt.line === 2, JSON.stringify(verifyBroken.brokenAt))

console.log('\n--- integration: the harness working directory wins over the session header ---')
const wdRoot = await mkdtemp(join(tmpdir(), 'research-record-wd-'))
const headerRoot = await mkdtemp(join(tmpdir(), 'research-record-header-'))
const host2 = makeHost(headerRoot, sessionId)
host2.ctx.workingDirectory = { async ensure() { return wdRoot } }
guardModule.apply(host2.ctx, undefined)
notebookModule.apply(host2.ctx, undefined)
provenanceModule.apply(host2.ctx, undefined)
const tool2 = (toolName) => {
  const definition = host2.tools.get(toolName)
  if (definition === undefined) throw new Error(`tool ${toolName} is not registered`)
  return definition
}
const run2 = (toolName, args) => tool2(toolName).execute(args, execFor(`${toolName}-2`, toolName, args))

const policyDefault = await run2('policy_status', {})
check('integration: the effective directory comes from workingDirectory', policyDefault.workspace === wdRoot, `${policyDefault.workspace} != ${wdRoot}`)
check('integration: guard protects user_data/** by default', policyDefault.protectedPaths.includes('user_data/**'), JSON.stringify(policyDefault.protectedPaths))
check('integration: guard protects data/** by default', policyDefault.protectedPaths.includes('data/**'), JSON.stringify(policyDefault.protectedPaths))

const preExecute2 = (host2.handlers.get('tools/pre-execute') ?? [])[0]
const deniedByDefault = await preExecute2(execFor('guard-default', 'write', { file_path: 'user_data/raw.csv' }), allow)
check('integration: a write to user_data/** is denied without any policy file', deniedByDefault?.kind === 'deny', JSON.stringify(deniedByDefault))

await run2('notebook', { type: 'note', title: 'journal follows the working directory' })
const journalThere = await stat(join(wdRoot, '.dsh', 'notebook', `${sessionId}.jsonl`)).then(() => true).catch(() => false)
const journalElsewhere = await stat(join(headerRoot, '.dsh', 'notebook', `${sessionId}.jsonl`)).then(() => true).catch(() => false)
check('integration: the journal lands in the working directory', journalThere === true, wdRoot)
check('integration: the session header directory stays untouched', journalElsewhere === false, headerRoot)

const wdFile = join(wdRoot, 'derived-probe.csv')
await mkdir(dirname(wdFile), { recursive: true })
await writeFile(wdFile, 'a,b\n1,2\n', 'utf8')
const resultHandlers = host2.handlers.get('tools/result') ?? []
for (const handler of resultHandlers) await handler(execFor('call-wd-1', 'write', { file_path: wdFile }), { isError: false, value: {} })
const stepThere = await stat(join(wdRoot, '.dsh', 'provenance', sessionId, 'steps.jsonl')).then(() => true).catch(() => false)
check('integration: provenance steps follow the working directory', stepThere === true, wdRoot)

await rm(wdRoot, { recursive: true, force: true })
await rm(headerRoot, { recursive: true, force: true })

console.log('\n--- summary ---')
console.log(`${checks.filter((c) => c.ok).length}/${checks.length} checks passed`)
if (failures.length > 0) {
  console.log('\nfailures:')
  for (const failure of failures) console.log(`  - ${failure}`)
}
if (!process.argv.includes('--keep')) await rm(workspace, { recursive: true, force: true })
else console.log(`kept: ${workspace}`)
process.exit(failures.length === 0 ? 0 : 1)
