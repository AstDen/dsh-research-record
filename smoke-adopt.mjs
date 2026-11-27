/**
 * Acceptance checks for the project-adoption plugin (survey.js).
 *
 * The tree below is deliberately messy the way a real one is: a run folder with
 * a table and a log, a paper folder with a `.tex` that never compiled, a
 * literature folder with a PDF, a notebook, an image, a mesh, an empty folder
 * whose name promises something, and an archive nobody has unpacked.
 */
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  adoptProject,
  extractFacts,
  planAdoption,
  renderArchivalJournal,
  renderMap,
  summarizeMap,
  walkTree,
  kindOf,
} from './survey.js'
import { FIXTURE_NAMES, buildFixtures } from './fixtures/adoption.mjs'
import { sniffBuffer } from './packs.js'

let passed = 0
let failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    return
  }
  failed += 1
  console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
}

async function buildTree(root) {
  const files = [
    ['прогоны/2023_09_вар1/results/dpdx.csv', 'u,dpdx_darcy,dpdx_inertial\n0.01,12.4,0.3\n0.02,24.8,1.2\n'],
    ['прогоны/2023_09_вар1/log/solver.log', 'Time = 0.01\nCdi = 0.41\n'],
    ['прогоны/2023_09_вар1/README.md', '# Вар1\n'],
    ['статьи/draft_v2/main.tex', '\\documentclass{article}\n\\title{Ламинарный поток в пористой трубе}\n\\begin{document}\n\\end{document}\n'],
    ['статьи/draft_v2/figures/figure1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['литература/refs/galowin1974.pdf', Buffer.from('%PDF-1.4 fake')],
    ['литература/refs/library.bib', '@article{galowin1974,\n title={X}\n}\n'],
    ['analysis/scratch.ipynb', '{"cells":[{"cell_type":"markdown"},{"cell_type":"code"}],"metadata":{}}'],
    ['data/raw/tomo/slice_001.tif', Buffer.from([1, 2, 3])],
    ['data/raw/tomo/slice_002.tif', Buffer.from([4, 5, 6])],
    ['models/mesh_1mm.msh', 'fake mesh\n'],
    ['пусто_потом', null],
    ['архив/old_results.zip', Buffer.from([1, 2, 3, 4])],
    ['scripts/post.py', 'print("x")\n'],
  ]
  for (const [path, content] of files) {
    const full = join(root, path)
    await mkdir(join(full, '..'), { recursive: true })
    if (content === null) await mkdir(full, { recursive: true })
    else await writeFile(full, content)
  }
}

const workspace = await mkdtemp(join(tmpdir(), 'adopt-ws-'))
const project = join(workspace, '20_gradient_channel')
await buildTree(project)

// --- walk and map ----------------------------------------------------------
check('raw data tif is image-like, not table', kindOf('slice.tif') === 'image')
check('openfoam field file is mesh', kindOf('case_1.dat.h5') === 'mesh')
const map = await walkTree(project)
const summary = summarizeMap(map)
check('walk finds every directory that has files', summary.directories >= 10, String(summary.directories))
check('walk counts files', summary.files === 13, String(summary.files))
check('no marker written by default', (await readdir(project)).includes('.dsh-map.json') === false)
check('run-like directory detected', summary.notable.runLike.some((path) => path.includes('2023_09')), summary.notable.runLike.join(','))
check('paper-like directory detected', summary.notable.paperLike.some((path) => path.includes('draft_v2')), summary.notable.paperLike.join(','))
check('literature directory detected', summary.notable.literatureLike.some((path) => path.includes('литература')), summary.notable.literatureLike.join(','))
check('empty directory detected', summary.notable.empty.some((path) => path.includes('пусто_потом')), summary.notable.empty.join(','))
check('kinds counted', summary.byKind.table === 1 && summary.byKind.pdf === 1 && summary.byKind.tex === 1 && summary.byKind.notebook === 1,
  JSON.stringify(summary.byKind))
check('a .bib is a bibliography, not an unknown', summary.byKind.bib === 1, JSON.stringify(summary.byKind))
check('figure png and two tif images are images', summary.byKind.image === 3, JSON.stringify(summary.byKind))
check('mesh classified as mesh, not binary', summary.byKind.mesh === 1, JSON.stringify(summary.byKind))

const mapText = renderMap(map, summary)
check('map has the header', mapText.includes('Карта проекта'))
check('map shows the tree', mapText.includes('прогоны/') && mapText.includes('литература/'))
check('map reports volume', /объём:/.test(mapText))

// --- facts -----------------------------------------------------------------
const facts = await extractFacts(project, map)
const table = facts.find((fact) => fact.path.endsWith('dpdx.csv'))
check('csv columns extracted', table !== undefined && table.text.includes('u') && table.text.includes('dpdx_darcy'), table?.text)
const tex = facts.find((fact) => fact.path.endsWith('main.tex'))
check('latex title extracted', tex !== undefined && tex.text.includes('Ламинарный поток'), tex?.text)
const notebook = facts.find((fact) => fact.path.endsWith('.ipynb'))
check('notebook cell count', notebook !== undefined && /ячеек/.test(notebook.text), notebook?.text)
check('pdf recorded as a fact without parsing', facts.some((fact) => fact.kind === 'pdf' && fact.path.endsWith('galowin1974.pdf')))
check('fact limit respected', facts.length <= 40)

// --- plans -----------------------------------------------------------------
const asIs = planAdoption(map, summary, { mode: 'as-is' })
const light = planAdoption(map, summary, { mode: 'light' })
const restructure = planAdoption(map, summary, { mode: 'restructure' })
const createPath = (item) => (typeof item === 'string' ? item : item.path)
check('as-is creates no project folders', asIs.creates.every((item) => !createPath(item).startsWith('literature') && !createPath(item).startsWith('runs')), asIs.creates.map(createPath).join('|'))
check('every create carries a reason', asIs.creates.every((item) => typeof item === 'string' || (typeof item.reason === 'string' && item.reason.length > 5)))
check('as-is keeps everything', asIs.keeps.length > 0 && asIs.moves.length === 0)
check('light adds standard folders', light.creates.some((item) => createPath(item).startsWith('literature/')))
check('light moves nothing', light.moves.length === 0)
check('light keeps the existing literature folder', light.keeps.some((item) => item.includes('литература')), light.keeps.join('|'))
check('restructure lists candidate moves', restructure.moves.length >= 4, String(restructure.moves.length))
check('restructure never proposes moving archives', restructure.keeps.some((item) => item.includes('архив')), restructure.keeps.join('|'))
check('restructure protects raw data', restructure.keeps.some((item) => item.includes('data/raw')))
check('every plan asks the owner something', asIs.questions.length > 0 && light.questions.length > 0 && restructure.questions.length > 0)

const journal = renderArchivalJournal({ map, summary, facts, plans: [asIs, light, restructure], root: project })
check('journal separates facts from guesses', journal.includes('## 2. Факты') && journal.includes('## 3. Оценки'))
check('journal contains the map section', journal.includes('## 1. Карта'))
check('journal lists all three plans', journal.includes('Встроиться как есть') && journal.includes('Встроиться легко') && journal.includes('Перестроить'))
check('journal ends with questions for the owner', journal.includes('## 6. Что спросить у владельца'))
check('journal does not call the project bad', !/плохом состоянии/.test(journal))

// --- plan-only adopt writes nothing outside .dsh --------------------------
const dry = await adoptProject(workspace, { root: project, mode: 'light' })
check('dry run writes no map file', (await readdir(join(workspace, '.dsh', 'map')).catch(() => [])).includes('map.md') === false)
check('dry run creates no standard folders', (await readdir(project)).includes('hypotheses') === false)
check('dry run still plans', dry.plans.length === 3 && dry.planText.includes('Встроиться легко'))

// --- apply: additive only -------------------------------------------------
const before = new Map()
for (const path of ['прогоны/2023_09_вар1/results/dpdx.csv', 'статьи/draft_v2/main.tex', 'data/raw/tomo/slice_001.tif']) {
  before.set(path, (await stat(join(project, path))).mtimeMs)
}
const applied = await adoptProject(workspace, { root: project, mode: 'light', apply: true })
check('apply writes the map', applied.created.some((item) => item.endsWith('.dsh/map/map.md')), applied.created.join('|'))
check('apply writes the tree json', applied.created.some((item) => item.endsWith('tree.json')))
check('apply writes the archival journal', (await readFile(join(workspace, '.dsh', 'map', 'archival-journal.md'), 'utf8')).includes('Архивный лабораторный журнал'))
check('apply creates policy', JSON.parse(await readFile(join(workspace, '.dsh', 'policy.json'), 'utf8')).protectedPaths.length > 0)
check('apply writes an AGENTS pointer', (await readFile(join(project, 'AGENTS.md'), 'utf8')).includes('.dsh/map/'))
check('light creates standard folders', (await readdir(project)).includes('hypotheses') && (await readdir(project)).includes('paper'))
check('light writes the index', (await readFile(join(project, 'literature', '_INDEX.md'), 'utf8')).includes('Файлы не перемещались'))
for (const [path, mtime] of before) {
  check(`apply leaves ${path} untouched`, (await stat(join(project, path))).mtimeMs === mtime)
}
check('apply does not delete the archive', (await stat(join(project, 'архив', 'old_results.zip'))).size === 4)

// --- as-is apply keeps the tree pristine ----------------------------------
const project2 = join(workspace, 'second_project')
await writeFile(join(workspace, 'placeholder'), '')
await mkdir(project2, { recursive: true })
await writeFile(join(project2, 'notes.txt'), 'x\n')
const asIsApplied = await adoptProject(workspace, { root: project2, mode: 'as-is', apply: true })
check('as-is adds no standard folders', (await readdir(project2)).sort().join(',') === 'AGENTS.md,notes.txt', (await readdir(project2)).join(','))
check('as-is still writes the journal', asIsApplied.created.some((item) => item.endsWith('archival-journal.md')))

// --- markers --------------------------------------------------------------
const project3 = join(workspace, 'third_project')
await mkdir(join(project3, 'sub'), { recursive: true })
await writeFile(join(project3, 'a.csv'), 'x,y\n1,2\n')
const marked = await walkTree(project3, { markers: true })
check('markers written when asked', (await readdir(project3)).includes('.dsh-map.json'))
check('marker names the directory', JSON.parse(await readFile(join(project3, '.dsh-map.json'), 'utf8')).files === 1)
check('marker reports its own directory', marked.markersWritten === true)

// --- limits ---------------------------------------------------------------
const limited = await walkTree(project, { maxFiles: 3 })
const limitedSummary = summarizeMap(limited)
check('max_files stops the walk', limitedSummary.files === 3, String(limitedSummary.files))
check('limit is reported, not hidden', limitedSummary.truncated === true)

// --- five archetypes ------------------------------------------------------
// One person's CFD projects are not the acceptance test: the universal rules
// must also work for measurements, sources, a hand-written solver and a tree
// nothing recognises. Every fixture states what the classifier must find.
const fixtureRoot = await mkdtemp(join(tmpdir(), 'adoption-fixtures-'))
await buildFixtures(fixtureRoot)
const fixtures = {}
for (const name of FIXTURE_NAMES) {
  const map = await walkTree(join(fixtureRoot, name), { maxDepth: 6 })
  fixtures[name] = { map, summary: summarizeMap(map), light: planAdoption(map, summarizeMap(map), { mode: 'light' }) }
}

check('exp-session: experiment pack wins', fixtures['exp-session'].summary.packs.some((hit) => hit.id === 'experiment'), JSON.stringify(fixtures['exp-session'].summary.packs))
check('exp-session: a run directory is found', Object.prototype.hasOwnProperty.call(fixtures['exp-session'].summary.roles, 'run'), JSON.stringify(fixtures['exp-session'].summary.roles))
check('exp-session: nothing is unclassified', (fixtures['exp-session'].summary.byKind.other ?? 0) === 0, JSON.stringify(fixtures['exp-session'].summary.byKind))
check('lit-only: literature pack wins', fixtures['lit-only'].summary.packs.some((hit) => hit.id === 'literature'))
check('lit-only: a bibliography is recognised', (fixtures['lit-only'].summary.byKind.bib ?? 0) > 0, JSON.stringify(fixtures['lit-only'].summary.byKind))
check('lit-only: no run folder is created', fixtures['lit-only'].light.creates.every((item) => !(typeof item === 'string' ? item : item.path).startsWith('runs')), fixtures['lit-only'].light.creates.map((item) => (typeof item === 'string' ? item : item.path)).join(' '))
check('lit-only: literature folders are created', fixtures['lit-only'].light.creates.some((item) => (typeof item === 'string' ? item : item.path) === 'literature/refs'))
check('custom-code: custom-code pack wins', fixtures['custom-code'].summary.packs.some((hit) => hit.id === 'custom-code'))
check('custom-code: sources are recognised as analysis', fixtures['custom-code'].map.nodes.some((node) => node.path === 'src' && node.role === 'analysis'), JSON.stringify(fixtures['custom-code'].summary.roles))
check('unknown tree: no pack claims it', fixtures['unknown'].summary.packs.length === 0, JSON.stringify(fixtures['unknown'].summary.packs))
check('unknown tree: the owner is told what is unclassified', fixtures['unknown'].summary.unknownNames.length > 0, JSON.stringify(fixtures['unknown'].summary.unknownNames))
check('unknown tree: still no crash, no data folders invented', fixtures['unknown'].light.creates.every((item) => !(typeof item === 'string' ? item : item.path).startsWith('data')), fixtures['unknown'].light.creates.map((item) => (typeof item === 'string' ? item : item.path)).join(' '))
check('mixed tree: two packs are reported', fixtures.mixed.summary.packs.length >= 2, JSON.stringify(fixtures.mixed.summary.packs))

// magic sniffing says nothing about plain text
check('sniff: pdf by magic', sniffBuffer(Buffer.from('%PDF-1.7\n')) === 'pdf')
check('sniff: gzip by magic', sniffBuffer(Buffer.from([0x1f, 0x8b, 0x08, 0x00])) === 'archive')
check('sniff: OpenFOAM dictionary by text', sniffBuffer(Buffer.from('FoamFile\n{\n    version 2.0;\n}\n')) === 'dict')
check('sniff: table by repeated separator', sniffBuffer(Buffer.from('a,b,c\n1,2,3\n')) === 'table')
check('sniff: plain prose is not a finding', sniffBuffer(Buffer.from('just some notes\nabout the run\n')) === 'text')

// journal stays readable: the budget is a promise, not an aspiration
const bigMap = fixtures.mixed.map
const bigSummary = { ...fixtures.mixed.summary, notable: { ...fixtures.mixed.summary.notable, runLike: Array.from({ length: 500 }, (_, i) => `run_${i}/`) } }
const bigJournal = renderArchivalJournal({ map: bigMap, summary: bigSummary, facts: [], plans: [fixtures.mixed.light], root: 'fixture' })
check('journal obeys the 64 KB budget', bigJournal.length <= 64_500, String(bigJournal.length))
check('trimmed journal says it was trimmed', bigJournal.includes('сокращён по бюджету') || bigJournal.length <= 64_000)

console.log(`\nadoption: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
