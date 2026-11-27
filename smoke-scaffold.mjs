#!/usr/bin/env node
/**
 * smoke-scaffold.mjs — acceptance for the research-project scaffold.
 *
 * Checks the contract the user actually asked for: one action turns an empty
 * directory into a research project, the layout and forms are there, a second run
 * does not overwrite work, and a later session sees the project identity in its
 * prompt.
 *
 *   node smoke-scaffold.mjs
 */

import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeCtx } from './fixtures/ctx.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const scaffold = await import(join(resolve(here), 'scaffold.js'))

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok === true ? 'PASS' : 'FAIL'}  ${label}${ok === true || detail === '' ? '' : `  — ${detail}`}`)
  if (ok !== true) failures.push(label)
}
const exists = async (path) => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

// --- 1. an empty directory becomes a research project ------------------------
const workspace = await mkdtemp(join(tmpdir(), 'rr-scaffold-'))
const report = await scaffold.scaffoldResearchProject(workspace, { name: 'Porous combustion' })
check('scaffold reports success', report.ok === true)
check('project name is taken from the option', report.project === 'Porous combustion', report.project)

for (const folder of ['literature', 'literature/notes', 'hypotheses', 'models', 'runs', 'data/raw', 'data/derived', 'analysis/scripts', 'analysis/figures', 'analysis/tables', 'paper/sections', 'paper/figures', 'talks', 'admin']) {
  check(`folder ${folder}/ exists`, await exists(join(workspace, folder)))
}

for (const file of ['AGENTS.md', 'README.md', 'PROJECT.md', 'literature/README.md', 'hypotheses/registry.md', 'models/README.md', 'runs/README.md', 'analysis/README.md', 'paper/README.md', 'talks/README.md', '.dsh/policy.json', '.dsh/research-project.json']) {
  check(`file ${file} exists`, await exists(join(workspace, file)))
}

const agents = await readFile(join(workspace, 'AGENTS.md'), 'utf8')
check('AGENTS.md states the journal discipline', agents.includes('hypothesis') && agents.includes('observation') && agents.includes('data/raw'))
check('AGENTS.md forbids rewriting raw data', /never rewrite/i.test(agents))
check('AGENTS.md forbids fabricating paths and numbers', agents.includes('Do not invent') && agents.includes('Verification instead of guessing') && agents.includes('lives in…'))
check('AGENTS.md requires scripted computation', agents.includes('Scripts do the arithmetic') && agents.includes('analysis/scripts/'))
const analysisRules = await readFile(join(workspace, 'analysis/README.md'), 'utf8')
check('analysis rules repeat the script rule', /computed by a script/i.test(analysisRules))
const brief = await readFile(join(workspace, 'PROJECT.md'), 'utf8')
check('PROJECT.md is a form with the success criterion', brief.includes('What counts as success') && brief.includes('Porous combustion'))
const protocol = await readFile(join(workspace, 'runs/README.md'), 'utf8')
check('run protocol names the mandatory files', protocol.includes('run.md') && protocol.includes('conclusion.md'))
const policy = JSON.parse(await readFile(join(workspace, '.dsh/policy.json'), 'utf8'))
check('policy protects raw data', policy.protectedPaths.includes('data/raw/**'))
const marker = JSON.parse(await readFile(join(workspace, '.dsh/research-project.json'), 'utf8'))
check('marker identifies a research project', marker.kind === 'research-project' && marker.name === 'Porous combustion')
check('marker lists the folders with purposes', Array.isArray(marker.folders) && marker.folders.some((entry) => entry.path === 'runs' && typeof entry.purpose === 'string'))

// --- 2. a second run keeps the work -----------------------------------------
const edited = `${brief.trimEnd()}\n\nOwner edit.\n`
await import('node:fs/promises').then((fs) => fs.writeFile(join(workspace, 'PROJECT.md'), edited, 'utf8'))
const second = await scaffold.scaffoldResearchProject(workspace, {})
check('second run keeps an edited form', (await readFile(join(workspace, 'PROJECT.md'), 'utf8')) === edited)
check('second run reports what it skipped', second.skipped.includes('PROJECT.md') && second.skipped.includes('AGENTS.md'), second.skipped.join(','))
check('second run keeps the creation time', second.marker.createdAt === marker.createdAt)

// --- 3. the tool and the command both reach the same scaffold ---------------
const handlers = new Map()
const tools = new Map()
const sections = []
const notes = []
const ctx = makeCtx(
  {
    sessions: { get: (id) => (id === 'agent-1' ? { header: { id, cwd: workspace } } : undefined) },
    tools: { register(definition) { tools.set(definition.name, definition); return () => undefined } },
    commands: { register(definition) { handlers.set(definition.name, definition); return () => undefined } },
    systemPrompt: { section(section) { sections.push(section); return () => undefined } },
    workingDirectory: { ensure: async () => workspace },
  },
  { inject: scaffold.inject, label: 'smoke-scaffold' },
)
scaffold.apply(ctx, {})

check('tool research_init is registered', tools.has('research_init'))
check('command research-init is registered', handlers.has('research-init'))

const toolReport = await tools.get('research_init').execute(
  { brief: 'How does porosity affect the laminar flame speed?' },
  { agent: { id: 'agent-1' }, callId: 'call-1', name: 'research_init', arguments: {} },
)
check('tool report names the project', toolReport.ok === true && typeof toolReport.project === 'string')
check('brief is appended to PROJECT.md', /porosity affect/i.test(await readFile(join(workspace, 'PROJECT.md'), 'utf8')))

const rendered = tools.get('research_init').output.render({}, toolReport)
check('tool renders a readable summary', String(rendered[0]?.text ?? '').includes('research project ready'))

const commandResult = await handlers.get('research-init').handler({ agent: { id: 'agent-1' }, rawInput: '', signal: undefined, attachments: [], commandId: 'c-1' })
check('command returns a success result', commandResult.kind === 'success' && commandResult.text.includes('research project'), JSON.stringify(commandResult).slice(0, 120))

const identity = sections.find((section) => section.name === 'research-project-identity')
check('prompt section research-project-identity is registered', identity !== undefined)
const identityText = identity.text({ agent: { id: 'agent-1' } })
check('prompt announces the research project', identityText.includes('research project') && identityText.includes('Porous combustion'), identityText.slice(0, 120))
check('prompt names the journal discipline', identityText.includes('observation') && identityText.includes('PROJECT.md'))
check('prompt forbids fabrication and hand arithmetic', identityText.includes('do not invent') && identityText.includes('analysis/scripts/'))
check('a foreign workspace gets no identity', identity.text({ agent: { id: 'unknown' } }) === '')

// the scaffold leaves a journal note, so the project's first record is not empty
const journalDir = join(workspace, '.dsh', 'notebook')
const journalFiles = await readdir(journalDir).catch(() => [])
check('journal note about the scaffold exists', journalFiles.length > 0, journalFiles.join(','))
if (journalFiles.length > 0) {
  const rows = (await readFile(join(journalDir, journalFiles[0]), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  check('journal note is tagged auto', rows.some((row) => row.auto === true && row.tags?.includes('auto')))
}

void notes
console.log(`\n${failures.length === 0 ? 'scaffold holds' : `${failures.length} failed: ${failures.join(', ')}`}`)
process.exit(failures.length === 0 ? 0 : 1)
