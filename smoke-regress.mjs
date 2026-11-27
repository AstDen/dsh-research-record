#!/usr/bin/env node
/**
 * smoke-regress.mjs — regression suite for the defects found in the 0.8.1 audit.
 *
 * Every case here reproduced a real failure on 0.8.1 (see
 * ../dsh-research-record-audit/repro/). The suite asserts the *fixed* behaviour,
 * so before the fix the case is red and after it green — that is the point.
 *
 * The context is the cordis-faithful fixture: `workingDirectory` and `sessions`
 * are services this bundle does not inject, so the plugins can only reach them
 * through `ctx.get(name)`, exactly as in a real host.
 *
 *   node smoke-regress.mjs          # exit 1 while any defect is still present
 */

import { mkdir, mkdtemp, readdir, readFile, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeCtx, toolBox } from './fixtures/ctx.mjs'
import * as guard from './guard.js'
import * as lock from './lock.js'
import * as notebook from './notebook.js'
import * as provenance from './provenance.js'
import * as scaffold from './scaffold.js'
import * as survey from './survey.js'

const checks = []
function check(id, label, condition, detail = '') {
  checks.push({ id, ok: condition === true, label })
  console.log(`${condition === true ? 'PASS' : 'FAIL'}  ${id}  ${label}${condition === true ? '' : `  — ${detail}`}`)
}

const MODULES = [notebook, guard, provenance, survey, scaffold]

/**
 * One isolated workspace with every plugin of the bundle loaded.
 * @param {string} [sessionId]
 */
async function freshHost(sessionId = 's1') {
  const workspace = await mkdtemp(join(tmpdir(), 'rr-regress-'))
  const tools = toolBox()
  const sections = []
  const services = {
    workingDirectory: { ensure: async () => workspace },
    // A real SessionStore exposes both get() and list(); the panel trusts the
    // workspaces of live sessions, so the fixture must carry the same surface.
    sessions: {
      get: (id) => ({ header: { id, cwd: workspace } }),
      list: () => [{ header: { id: sessionId, cwd: workspace } }],
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => undefined
      },
    },
    commands: { register: () => () => undefined },
  }
  const ctx = makeCtx({ tools, ...services }, { inject: ['tools', 'systemPrompt', 'commands'], label: 'regress' })
  for (const plugin of MODULES) plugin.apply(ctx, {})
  const call = async (name, args, session = sessionId) => {
    const definition = tools.map.get(name)
    if (definition === undefined) throw new Error(`tool ${name} is not registered`)
    return definition.execute(args, { agent: { id: session }, callId: `call-${name}`, name, signal: undefined, arguments: args })
  }
  const fire = async (event, ...args) => {
    for (const handler of ctx.__handlers.get(event) ?? []) await handler(...args)
  }
  return { workspace, ctx, tools, sections, call, fire, session: { header: { id: sessionId } } }
}

async function sha256(text) {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(text).digest('hex')
}

// ── B1: a torn tail must not be silently appended to ───────────────────────
{
  const host = await freshHost()
  const first = await host.call('notebook', { type: 'note', title: 'first', body: 'one' })
  const file = first.journal
  const size = (await stat(file)).size
  await truncate(file, size - 30) // simulate a kill/ENOSPC in the middle of a write

  const second = await host.call('notebook', { type: 'note', title: 'second', body: 'two' })
  check(
    'B1',
    'refuses to append to a truncated tail instead of corrupting it',
    second.ok === false && /truncat|tail|repair/i.test(String(second.error ?? '')),
    `ok=${second.ok} error=${second.error}`,
  )

  const repaired = await host.call('notebook_verify', { repair: true })
  check('B1', 'repair trims the torn tail and reports what it did', repaired.ok === true && repaired.repaired !== undefined, JSON.stringify(repaired).slice(0, 200))

  const third = await host.call('notebook', { type: 'note', title: 'third', body: 'three' })
  const verify = await host.call('notebook_verify', {})
  check('B1', 'the journal is appendable and the chain is valid after repair', third.ok === true && verify.ok === true, `append=${third.ok} verify=${verify.ok}`)
}

// ── H2: concurrent appends must not break prevHash ─────────────────────────
{
  const host = await freshHost()
  const results = await Promise.all(
    Array.from({ length: 12 }, (_unused, index) => host.call('notebook', { type: 'note', title: `parallel-${index}` })),
  )
  const verify = await host.call('notebook_verify', {})
  const written = results.filter((result) => result.ok === true).length
  check('H2', '12 concurrent appends keep the chain valid', verify.ok === true, `${written}/12 written, problems=${JSON.stringify(verify.problems ?? verify.brokenAt)}`)
}

// ── H3: a forged record must not pass as valid ────────────────────────────
{
  const host = await freshHost()
  const created = await host.call('notebook', { type: 'observation', title: 'real result', body: 'truth', outcome: 'signal' })
  const text = await readFile(created.journal, 'utf8')
  const record = JSON.parse(text.trim())
  await writeFile(created.journal, JSON.stringify({ ...record, title: 'FORGED RESULT' }) + '\n')

  const read = await host.call('notebook_search', { action: 'read', id: record.id, expectedDigest: record.hash })
  check('H3', 'notebook_search refuses a record whose content no longer matches its hash', read.ok === false && /digest|hash/i.test(String(read.error ?? '')), `ok=${read.ok} title=${JSON.stringify(read.record?.title)}`)

  const verify = await host.call('notebook_verify', {})
  check('H3', 'notebook_verify still names the tampered line', verify.ok === false, JSON.stringify(verify.brokenAt ?? verify.problems))
}

// ── H4: survey markers must stay inside the project ───────────────────────
{
  const host = await freshHost()
  await mkdir(join(host.workspace, 'proj', 'sub'), { recursive: true })
  await writeFile(join(host.workspace, 'proj', 'sub', 'notes.md'), 'OWNER NOTES')

  const escaped = await host.call('project_survey', { path: 'proj', markers: true, marker_name: '../OUTSIDE.md' })
  let outsideExists = true
  try {
    await stat(join(host.workspace, 'OUTSIDE.md'))
  } catch {
    outsideExists = false
  }
  check('H4', 'a marker name with ../ cannot write outside the surveyed project', outsideExists === false, `ok=${escaped.ok} outside=${outsideExists}`)

  await host.call('project_survey', { path: 'proj', markers: true, marker_name: 'notes.md', max_depth: 2 })
  const notes = await readFile(join(host.workspace, 'proj', 'sub', 'notes.md'), 'utf8')
  check('H4', 'a marker never overwrites an owner file of the same name', notes === 'OWNER NOTES', JSON.stringify(notes.slice(0, 40)))
}

// ── H5: adoption must never overwrite the owner's index ───────────────────
{
  const host = await freshHost()
  await mkdir(join(host.workspace, 'proj', 'literature'), { recursive: true })
  await writeFile(join(host.workspace, 'proj', 'literature', '_INDEX.md'), 'OWNER INDEX\n')
  const adopted = await host.call('project_adopt', { path: 'proj', mode: 'light', apply: true })
  const index = await readFile(join(host.workspace, 'proj', 'literature', '_INDEX.md'), 'utf8')
  check('H5', 'project_adopt keeps the owner literature/_INDEX.md', index === 'OWNER INDEX\n', `content=${JSON.stringify(index.slice(0, 40))} created=${JSON.stringify(adopted.created)}`)
}

// ── H6: two sessions must not look like a time paradox ────────────────────
{
  const host = await freshHost()
  const step = (id, timestamp, path, sha) =>
    JSON.stringify({
      schemaVersion: 1,
      id,
      sessionId: 'x',
      runId: null,
      startedAt: timestamp,
      timestamp,
      toolName: 'write',
      args: {},
      isError: false,
      inputs: [],
      outputs: [{ path, sha256: sha, size: 3 }],
      fidelity: 'observed',
      environment: { node: '24', python: null, cwd: host.workspace },
    })
  const later = step('step-a1', '2026-01-02T00:00:00.000Z', 'f.txt', 'a'.repeat(64))
  const earlier = step('step-b1', '2026-01-01T00:00:00.000Z', 'f.txt', 'a'.repeat(64))
  await mkdir(join(host.workspace, '.dsh', 'provenance', 'a-session'), { recursive: true })
  await mkdir(join(host.workspace, '.dsh', 'provenance', 'b-session'), { recursive: true })
  await writeFile(join(host.workspace, '.dsh', 'provenance', 'a-session', 'steps.jsonl'), later + '\n')
  await writeFile(join(host.workspace, '.dsh', 'provenance', 'b-session', 'steps.jsonl'), earlier + '\n')
  await writeFile(join(host.workspace, 'f.txt'), 'NEW')

  const verify = await host.call('provenance_verify', {})
  check('H6', 'provenance_verify accepts two sessions with interleaved timestamps', verify.ok === true, JSON.stringify(verify.problems))

  const perSession = await host.call('provenance_verify', { session: 'a-session' })
  check('H6', 'per-session verification still works', perSession.ok === true, JSON.stringify(perSession.problems))
}

// ── M1: the guard table (write protection, destructive confirm, read allow) ─
{
  const host = await freshHost()
  const preExecute = (host.ctx.__handlers.get('tools/pre-execute') ?? [])[0]
  const decide = async (command) => {
    const exec = { name: 'bash', callId: `call-${Math.random()}`, agent: { id: 's1' }, arguments: { command } }
    const decision = await preExecute(exec, async () => ({ kind: 'allow' }))
    return decision?.kind ?? 'undefined'
  }

  const table = [
    ['rm -r -f user_data', 'deny'],
    ['rm -Rf data', 'deny'],
    ['rm -rf user_data', 'deny'],
    ['cp derived/out.csv user_data/', 'deny'],
    ['mv out.csv data/', 'deny'],
    ['python3 analyze.py data/raw.csv', 'allow'],
    ['sed -n 1p data/raw.csv', 'allow'],
    ['awk -F, "{print $1}" data/raw.csv', 'allow'],
    ['cat data/raw.csv', 'allow'],
    ['rm -rf derived/old', 'ask'],
    ['git reset --hard', 'ask'],
    ['ls -la', 'allow'],
  ]
  const wrong = []
  for (const [command, expected] of table) {
    const actual = await decide(command)
    if (actual !== expected) wrong.push(`${command} → ${actual}, want ${expected}`)
  }
  check('M1', 'the guard table holds for rm/cp/mv/interpreter reads', wrong.length === 0, wrong.join(' | '))
}

// ── M2: the scaffold's own policy must allow data/derived ─────────────────
{
  const host = await freshHost()
  await mkdir(join(host.workspace, '.dsh'), { recursive: true })
  await writeFile(
    join(host.workspace, '.dsh', 'policy.json'),
    JSON.stringify(
      { protectedPaths: ['data/raw/**', 'data/**'], allowPaths: ['data/derived/**', 'derived/**'], destructiveConfirm: true },
      null,
      2,
    ),
  )
  const preExecute = (host.ctx.__handlers.get('tools/pre-execute') ?? [])[0]
  const decide = async (filePath) =>
    (await preExecute({ name: 'write', callId: `call-${Math.random()}`, agent: { id: 's1' }, arguments: { file_path: filePath } }, async () => ({ kind: 'allow' })))?.kind ?? 'undefined'
  const derived = await decide('data/derived/clean.csv')
  const raw = await decide('data/raw/original.csv')
  check('M2', 'the scaffold policy allows data/derived and still refuses data/raw', derived === 'allow' && raw === 'deny', `derived=${derived} raw=${raw}`)
  const status = await host.call('policy_status', {})
  check(
    'M2',
    'policy_status reports the exemptions it granted',
    Array.isArray(status.allowPaths) && status.allowPaths.some((entry) => String(entry).includes('derived')),
    `allowPaths=${JSON.stringify(status.allowPaths)}`,
  )
  const rendered = host.tools.map.get('policy_status').output.render({}, status)
  const statusText = rendered.map((block) => block.text ?? '').join('\n')
  check('M2', 'policy_status prints the exemptions', /^allowed:\s+.*derived/m.test(statusText), statusText.split('\n').slice(0, 7).join(' | '))
}

// ── M16: a relative write after `cd` resolves against that directory ──────
{
  const host = await freshHost()
  const preExecute = (host.ctx.__handlers.get('tools/pre-execute') ?? [])[0]
  const decide = async (command) =>
    (await preExecute({ name: 'bash', callId: `call-${Math.random()}`, agent: { id: 's1' }, arguments: { command } }, async () => ({ kind: 'allow' })))?.kind ?? 'undefined'
  const candidates = guard.bashCandidates('cd data && rm raw.csv')
  check('M16', 'a write after cd is reported where it lands', candidates.includes('data/raw.csv'), JSON.stringify(candidates))
  const denied = await decide('cd data && rm raw.csv')
  const allowed = await decide('cd derived && rm old.csv')
  check(
    'M16',
    'cd data && rm raw.csv is denied, cd derived && rm old.csv is allowed',
    denied === 'deny' && allowed === 'allow',
    `deny=${denied} allow=${allowed}`,
  )
  const plain = guard.bashCandidates('cd data && rm raw.csv')
  check('M16', 'the verb is not reported as a destination', plain.length === 1 && plain[0] === 'data/raw.csv', JSON.stringify(plain))
  const absolute = guard.bashCandidates('cd /tmp && rm -f notes.csv')
  check('M16', 'cd to an absolute path keeps the absolute candidate', absolute.includes('/tmp/notes.csv'), JSON.stringify(absolute))
  const read = await decide('cd data && cat raw.csv')
  check('M16', 'reading after cd is still allowed', read === 'allow', `decision=${read}`)
}

// ── M17: an interpreter fed through a heredoc is a question, not a pass ───
{
  const host = await freshHost()
  const preExecute = (host.ctx.__handlers.get('tools/pre-execute') ?? [])[0]
  const decide = async (command) =>
    (await preExecute({ name: 'bash', callId: `call-${Math.random()}`, agent: { id: 's1' }, arguments: { command } }, async () => ({ kind: 'allow' })))?.kind ?? 'undefined'
  const script = "python3 - <<'PY'\nopen('data/raw.csv','w').write('x')\nPY"
  const heredoc = await decide(script)
  check('M17', 'a script from a heredoc asks instead of passing', heredoc === 'ask', `decision=${heredoc}`)
  const empty = await decide("python3 - <<'PY'\nPY")
  check('M17', 'an empty heredoc is not a question', empty === 'allow', `decision=${empty}`)
  const textDoc = await decide("cat > derived/notes.md <<'EOF'\n# notes\nEOF")
  check('M17', 'a heredoc into a file is checked by its destination, not asked', textDoc === 'allow', `decision=${textDoc}`)
  const blockedDoc = await decide("cat > data/notes.md <<'EOF'\n# notes\nEOF")
  check('M17', 'a heredoc writing a protected path is still denied', blockedDoc === 'deny', `decision=${blockedDoc}`)
  const direct = guard.bashUnverifiable(script)
  check('M17', 'bashUnverifiable names the delimiter and the body size', direct?.delimiter === 'PY' && direct?.lines === 1, JSON.stringify(direct))
}

// ── M3: max_files must actually stop the walk ─────────────────────────────
{
  const host = await freshHost()
  for (let index = 0; index < 10; index += 1) {
    await mkdir(join(host.workspace, 'proj', `d${index}`), { recursive: true })
    await writeFile(join(host.workspace, 'proj', `d${index}`, `f${index}.md`), `# ${index}\n`)
  }
  const surveyResult = await host.call('project_survey', { path: 'proj', max_files: 3 })
  const files = surveyResult.summary?.files ?? -1
  const directories = surveyResult.summary?.directories ?? -1
  check(
    'M3',
    'max_files stops the walk at the limit and says so',
    files <= 3 && surveyResult.truncated === true && directories <= 4,
    `files=${files} directories=${directories} truncated=${surveyResult.truncated}`,
  )
}

// ── M4: adoption must refuse a root outside the workspace ─────────────────
{
  const host = await freshHost()
  const outside = await mkdtemp(join(tmpdir(), 'rr-outside-'))
  const adopted = await host.call('project_adopt', { path: outside, mode: 'light', apply: true })
  let leaked = true
  try {
    await stat(join(outside, 'admin'))
  } catch {
    leaked = false
  }
  check('M4', 'project_adopt refuses a root outside the workspace', leaked === false, `created admin/ outside: ${leaked}, ok=${adopted.ok} error=${adopted.error}`)
}

// ── M5: a malformed pack pattern must not break the survey ────────────────
{
  const host = await freshHost()
  await mkdir(join(host.workspace, '.dsh', 'packs'), { recursive: true })
  await writeFile(
    join(host.workspace, '.dsh', 'packs', 'broken.json'),
    JSON.stringify({ id: 'broken', dirs: [{ role: 'run', nameMatches: '([unclosed' }] }),
  )
  await writeFile(join(host.workspace, 'run1.csv'), 't,v\n1,2\n')
  const surveyed = await host.call('project_survey', { path: host.workspace })
  const answered = surveyed !== undefined && (surveyed.map !== undefined || surveyed.summary !== undefined)
  check(
    'M5',
    'a malformed pack signature is skipped, the survey still answers',
    answered,
    `keys=${surveyed === undefined ? 'undefined' : Object.keys(surveyed).join(',')}`,
  )
}

// ── M6: a failed write must not claim an output hash ──────────────────────
{
  const host = await freshHost()
  await writeFile(join(host.workspace, 'notes.md'), 'hello\n')
  await host.fire(
    'tools/result',
    { callId: 'c-fail', name: 'write', agent: { id: 's1' }, arguments: { file_path: join(host.workspace, 'notes.md'), content: 'other\n' } },
    { isError: true, error: { message: 'disk full' }, content: [] },
  )
  const steps = (await readFile(join(host.workspace, '.dsh', 'provenance', 's1', 'steps.jsonl'), 'utf8'))
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
  const failedStep = steps.find((step) => step.toolName === 'write' && step.isError === true)
  check(
    'M6',
    'a failed write records no output edge',
    failedStep !== undefined && (failedStep.outputs ?? []).length === 0,
    `step=${failedStep === undefined ? 'none' : JSON.stringify(failedStep.outputs)}`,
  )
}

// ── M7: file content never reaches steps.jsonl ────────────────────────────
{
  const host = await freshHost()
  const secret = 'SECRET-PAYLOAD-42'
  await writeFile(join(host.workspace, 'a.md'), secret)
  await host.fire(
    'tools/result',
    { callId: 'c-write', name: 'write', agent: { id: 's1' }, arguments: { file_path: join(host.workspace, 'a.md'), content: secret } },
    { isError: false, content: [] },
  )
  const raw = await readFile(join(host.workspace, '.dsh', 'provenance', 's1', 'steps.jsonl'), 'utf8')
  check('M7', 'the written content is redacted in the step args', !raw.includes(secret), `contains secret: ${raw.includes(secret)}`)
}

// ── M8: touch -r must not hide a change ───────────────────────────────────
{
  const host = await freshHost()
  const { utimes } = await import('node:fs/promises')
  const target = join(host.workspace, 'inputs')
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'x.csv'), 'a\n1\n')
  const before = await stat(join(target, 'x.csv'))
  await host.fire('session/event', host.session, { type: 'tool/call', data: { callId: 'c-m8', toolName: 'bash' }, timestamp: new Date().toISOString() })
  await new Promise((resolve) => setTimeout(resolve, 200))
  await writeFile(join(target, 'x.csv'), 'b\n2\n2\n')
  await utimes(join(target, 'x.csv'), before.atime, before.mtime)
  await host.fire(
    'tools/result',
    { callId: 'c-m8', name: 'bash', agent: { id: 's1' }, arguments: { command: 'touch -r inputs/x.csv /tmp/rr-ref && printf b > inputs/x.csv && touch -r /tmp/rr-ref inputs/x.csv' } },
    { isError: false, content: [] },
  )
  const steps = (await readFile(join(host.workspace, '.dsh', 'provenance', 's1', 'steps.jsonl'), 'utf8'))
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
  const bashStep = steps.find((step) => step.toolName === 'bash')
  check(
    'M8',
    'touch -r does not hide a content change from the bash scan',
    bashStep !== undefined && (bashStep.outputs ?? []).some((edge) => edge.path === 'inputs/x.csv'),
    `outputs=${JSON.stringify((bashStep?.outputs ?? []).map((edge) => edge.path))}`,
  )
}

// ── M9: the first bash after start sees outputs, not an empty list ────────
{
  const host = await freshHost()
  await host.fire('session/event', host.session, { type: 'tool/call', data: { callId: 'c-m9', toolName: 'bash' }, timestamp: new Date().toISOString() })
  await new Promise((resolve) => setTimeout(resolve, 200))
  await writeFile(join(host.workspace, 'fresh.csv'), 'x\n')
  await host.fire(
    'tools/result',
    { callId: 'c-m9', name: 'bash', agent: { id: 's1' }, arguments: { command: "printf x > fresh.csv" } },
    { isError: false, content: [] },
  )
  const steps = (await readFile(join(host.workspace, '.dsh', 'provenance', 's1', 'steps.jsonl'), 'utf8'))
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
  const bashStep = steps.find((step) => step.toolName === 'bash')
  // The pre-scan runs next to the command, so for a fast one it can finish
  // after the write. An input hash equal to the output hash is the file as it
  // is now; reporting it as "previous version" would claim two bytes that are
  // the same bytes.
  const stepsDir = join(host.workspace, '.dsh', 'provenance', 's1')
  const forged = {
    schemaVersion: 1,
    id: 'step-forged',
    sessionId: 's1',
    runId: 'run-forged',
    startedAt: '2026-01-01T00:00:00.000Z',
    timestamp: '2026-01-01T00:00:01.000Z',
    toolName: 'bash',
    args: { command: 'printf x > x.csv' },
    isError: false,
    fidelity: 'observed',
    inputs: [{ path: 'x.csv', sha256: 'a'.repeat(64), size: 2, status: 'ok' }],
    outputs: [{ path: 'x.csv', sha256: 'a'.repeat(64), size: 2, status: 'ok' }],
    environment: { node: process.version, python: null, cwd: host.workspace },
  }
  await writeFile(join(host.workspace, 'x.csv'), 'x\n')
  await writeFile(join(stepsDir, 'steps.jsonl'), `${JSON.stringify(forged)}\n`)
  const lineage = await host.call('provenance_of_file', { path: 'x.csv' })
  const node = (lineage.nodes ?? []).find((entry) => entry.path === 'x.csv')
  check(
    'M9',
    'a post-write pre-scan is not reported as the previous version',
    node !== undefined && node.previousSha256 === null,
    `previousSha256=${String(node?.previousSha256).slice(0, 12)}`,
  )

  check(
    'M9',
    'the first bash step records the file it created',
    bashStep !== undefined && (bashStep.outputs ?? []).some((edge) => edge.path === 'fresh.csv'),
    `outputs=${JSON.stringify((bashStep?.outputs ?? []).map((edge) => edge.path))}`,
  )
}

// ── H8: the panel must refuse a workspace that is not a session workspace ──
{
  const host = await freshHost()
  const stranger = await mkdtemp(join(tmpdir(), 'rr-stranger-'))
  const verdict = await notebook.panelWorkspace(host.ctx, stranger)
  check('H8', 'the panel refuses a workspace no session works in', verdict.ok === false, `ok=${verdict.ok} error=${verdict.error ?? ''}`)
  const own = await notebook.panelWorkspace(host.ctx, host.workspace)
  check('H8', 'the panel serves the workspace of the session', own.ok === true, `ok=${own.ok} error=${own.error ?? ''}`)
}

// ── M13: level 'all' shows every level, local specs are not registry installs ─
{
  const stack = await import('./stack.js')
  const all = stack.renderStack({ level: 'all' })
  const core = stack.renderStack({ level: 'core' })
  check(
    'M13',
    "level 'all' renders every level, not just the footer",
    all.includes('●') && all.includes('○') && all.length > core.length,
    `all=${all.length} core=${core.length}`,
  )
  const packages = stack.packagesForLevel('all')
  check(
    'M13',
    'a local checkout is not installed by package name',
    !packages.includes('fluent-case-builder') && stack.localEntriesFor('all').some((entry) => entry.id === 'fluent'),
    `packages=${packages.join(',')}`,
  )
}

// ── M14: the error sanitiser must strip a Windows home path ───────────────
{
  const telemetry = await import('./telemetry.js')
  const windows = telemetry.sanitizeError('ENOENT: C:\\Users\\bob\\x.csv missing', '/home/bob/proj')
  const posix = telemetry.sanitizeError('ENOENT: /home/bob/proj/runs/3/out.csv missing', '/home/bob/proj')
  check('M14', 'a Windows home path is replaced', !windows.includes('bob'), `text=${windows}`)
  check('M14', 'the workspace prefix is replaced', !posix.includes('/home/bob/proj'), `text=${posix}`)
}

// ── H7: Type 3 / embedding detection must actually fire ───────────────────
{
  const { spawnSync } = await import('node:child_process')
  const script = [
    'import sys, json',
    'sys.path.insert(0, ".")',
    'from figurelib.check import _pdf_font_facts',
    'data = b"%PDF-1.4 /BaseFont /Fake /Subtype /Type3"',
    'open("/tmp/rr-type3.pdf","wb").write(data)',
    'names, embedded, type3 = _pdf_font_facts("/tmp/rr-type3.pdf")',
    'print(json.dumps({"names": names, "embedded": embedded, "type3": type3}))',
  ].join('\n')
  const probe = spawnSync('python3', ['-c', script], { cwd: process.cwd(), encoding: 'utf8' })
  let facts = null
  try {
    facts = JSON.parse(probe.stdout.trim().split('\n').pop())
  } catch {
    facts = null
  }
  check(
    'H7',
    'a Type 3 font without an embedded program is detected',
    facts !== null && facts.type3 === true && facts.embedded === false && facts.names.includes('Fake'),
    `facts=${JSON.stringify(facts)} stderr=${probe.stderr.slice(0, 120)}`,
  )
}

// ── M15: the scaffold writes inside the workspace, backs up, and reports paths
{
  const host = await freshHost()
  const outside = await mkdtemp(join(tmpdir(), 'rr-scaffold-outside-'))
  const refused = await host.call('research_init', { path: outside })
  let leaked = true
  try {
    await stat(join(outside, 'PROJECT.md'))
  } catch {
    leaked = false
  }
  check(
    'M15',
    'research_init refuses a path outside the workspace',
    refused?.ok === false && leaked === false,
    `ok=${refused?.ok} error=${refused?.error} leaked=${leaked}`,
  )

  const inside = await host.call('research_init', { name: 'rr', brief: 'why does the model drift?' })
  const phantom = (inside?.created ?? []).filter((entry) => !entry.endsWith('/') && entry.includes('('))
  const second = await host.call('research_init', { name: 'rr' })
  check(
    'M15',
    'research_init reports real paths, never a labelled phantom',
    inside?.ok === true && phantom.length === 0 && Array.isArray(second?.updated),
    `created=${JSON.stringify(inside?.created)} phantom=${JSON.stringify(phantom)}`,
  )

  const forced = await host.call('research_init', { name: 'rr', force: true })
  const backups = (forced?.backedUp ?? []).length
  let backupOnDisk = false
  try {
    const entries = await readdir(host.workspace)
    backupOnDisk = entries.some((entry) => entry.startsWith('PROJECT.md.bak-'))
  } catch {
    backupOnDisk = false
  }
  check(
    'M15',
    'force keeps a backup of the form it overwrites',
    backups > 0 && backupOnDisk === true,
    `backedUp=${(forced?.backedUp ?? []).length} onDisk=${backupOnDisk}`,
  )
}

// ── Small: a CJK title must be searchable ────────────────────────────────
{
  const host = await freshHost()
  await host.call('notebook', { type: 'hypothesis', title: '石墨烯生长温度', body: '基底铜箔上的成核密度' })
  const hit = await host.call('notebook_search', { query: '石墨烯' })
  const single = await host.call('notebook_search', { query: '生长' })
  const rows = hit?.records ?? hit?.results ?? []
  const rowsSingle = single?.records ?? single?.results ?? []
  check(
    'Small',
    'a CJK title is found by a run and by its characters',
    rows.length > 0 && rowsSingle.length > 0,
    `run=${rows.length} chars=${rowsSingle.length}`,
  )
}

// ── M10: a lock that cannot be taken must fail, not write unlocked ────────
{
  const host = await freshHost()
  const target = join(host.workspace, 'locked.jsonl')
  await writeFile(target, '')
  await mkdir(`${target}.lock`, { recursive: true })
  await writeFile(join(`${target}.lock`, 'owner'), 'a-foreign-writer', 'utf8')
  let wrote = false
  let thrown = null
  try {
    await lock.withAppendLock(target, async () => {
      wrote = true
      return 'written'
    }, { retries: 2, waitMs: 1 })
  } catch (error) {
    thrown = error
  }
  check(
    'M10',
    'a held lock makes the append throw instead of writing unlocked',
    wrote === false && thrown?.code === 'LOCK_TIMEOUT',
    `wrote=${wrote} code=${thrown?.code} message=${String(thrown?.message).slice(0, 80)}`,
  )
  const owner = (await readFile(join(`${target}.lock`, 'owner'), 'utf8')).trim()
  check('M10', 'the failed writer leaves the foreign lock alone', owner === 'a-foreign-writer', `owner=${owner}`)
}

// ── M11: notebook input limits and cancellation ────────────────────────────
{
  const host = await freshHost()
  const huge = 'x'.repeat(600 * 1024)
  const tooLarge = await host.call('notebook', { type: 'note', title: 'huge', body: huge })
  check(
    'M11',
    'a record body over the input cap is refused',
    tooLarge?.ok === false && /too large/i.test(String(tooLarge?.error ?? '')),
    `ok=${tooLarge?.ok} error=${String(tooLarge?.error).slice(0, 100)}`,
  )
  const definition = host.tools.map.get('notebook')
  const aborted = await definition.execute(
    { type: 'note', title: 'aborted', body: 'never written' },
    { callId: 'c-abort', agent: { id: 's1' }, arguments: {}, signal: { aborted: true } },
  )
  check(
    'M11',
    'an aborted turn is refused before the write',
    aborted?.ok === false && /cancel/i.test(String(aborted?.error ?? '')),
    `ok=${aborted?.ok} error=${String(aborted?.error).slice(0, 100)}`,
  )
}

// ── Small: equal scores prefer the newer record ───────────────────────────
{
  const host = await freshHost()
  const older = (await host.call('notebook', { type: 'decision', title: 'swirl, use kOmegaSST', body: 'first guess' })).record
  const newer = (await host.call('notebook', { type: 'decision', title: 'swirl, use kOmegaSST', body: 'second guess' })).record
  const found = await host.call('notebook_search', { query: 'swirl' })
  const rows = found?.records ?? found?.results ?? []
  check(
    'Small',
    'a tie is broken towards the newest record',
    rows.length >= 2 && rows[0].id === newer.id && rows[1].id === older.id,
    `first=${rows[0]?.id} newest=${newer.id} count=${rows.length}`,
  )
}

const failed = checks.filter((entry) => entry.ok !== true)
console.log('')
console.log(`--- ${checks.length - failed.length}/${checks.length} regression checks hold ---`)
if (failed.length > 0) {
  console.log('still broken: ' + failed.map((entry) => entry.id).join(', '))
}
process.exit(failed.length === 0 ? 0 : 1)
