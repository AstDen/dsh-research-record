/**
 * dsh-research-record — research project scaffold.
 *
 * A bare directory gives the model no reason to behave like a scientist. This
 * module turns a directory into an explicit research project: a folder layout, a
 * brief form, a hypotheses registry, a run protocol, and an `AGENTS.md` that the
 * harness picks up as workspace instructions in every later session.
 *
 * Two entry points, one implementation:
 *   - tool `research_init` — the model calls it when the user says "this is a
 *     research project directory";
 *   - command `/research-init` — the user runs it directly, without a model turn.
 *
 * Both are idempotent: files are created only when missing, so re-running the
 * scaffold after adding folders never overwrites work.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { appendAutoNote, activeWorkspace, sessionWorkspace } from './notebook.js'
import { getService } from './services.js'

export const name = 'research-record-scaffold'
export const inject = ['tools', 'systemPrompt']

const MARKER = '.dsh/research-project.json'
const POLICY = '.dsh/policy.json'
const SCHEMA_VERSION = 1
const IDENTITY_TTL_MS = 5000

/** Folders every research project starts with, with the one-line purpose each. */
export const FOLDERS = [
  ['literature', 'sources: cards, quotes, PDFs'],
  ['literature/notes', 'one note per source'],
  ['literature/refs', 'PDFs and links as they are'],
  ['hypotheses', 'registry of hypotheses and ideas, decision statuses'],
  ['models', 'setups, geometry, boundary conditions, solver versions'],
  ['runs', 'runs: one directory = one run under the protocol'],
  ['runs/logs', 'raw solver logs'],
  ['data/raw', 'source data — read-only'],
  ['data/derived', 'derived data, rebuildable by a script'],
  ['analysis/scripts', 'analysis code that can be re-run'],
  ['analysis/figures', 'figures built by a script'],
  ['analysis/tables', 'result tables'],
  ['paper', 'paper: sources, sections, figures'],
  ['paper/sections', 'one file per section'],
  ['paper/figures', 'only the figures that made it into the paper'],
  ['talks', 'talks and presentations'],
  ['admin', 'reports, forms, applications, correspondence'],
]

const AGENTS_MD = `# Research project: working rules

This is a research project directory, not a folder of files. The agent works here as
the executor of a study under the project owner's direction: results must be
verifiable, not merely plausible.

## What is mandatory

1. **The journal is part of the work, not a report.** Before a run or a calculation
   write \`hypothesis\` (what we expect and why) and \`method\` (how exactly we test
   it). After it — \`observation\` with the numbers, units and the artifact path. A
   decision with its reason is a \`decision\`. A failure or a dead end is a record
   too, not silence.
2. **Never rewrite anything in \`data/raw/\`.** Source data is immutable: the work
   happens on copies in \`data/derived/\` or in the run directory.
3. **Every number comes from a file.** If the output states a value, there must be a
   path to the artifact it came from. The owner recomputing it must get the same.
4. **One run, one directory** in \`runs/\` following the protocol in
   \`runs/README.md\`: config, input data, log, result, conclusion. Without that the
   run does not exist.
5. **A script builds the figures**, one that lives in \`analysis/scripts/\`, not
   "by hand". A figure without a script can be neither checked nor rebuilt.
6. **A hypothesis lives in \`hypotheses/registry.md\`**, not only in the chat: it has
   an ID, a status, and a journal record that confirms or refutes it.
7. **Do not invent — verify.** A path is checked (\`ls\`, \`test -f\`), a number is
   taken from a file, not from memory. A file you have not opened cannot be cited,
   and a command you have not run cannot be described as executed. If a check
   failed, say so instead of filling the gap with a plausible answer.
8. **Scripts do the arithmetic.** Any arithmetic — unit conversion, mean, integral,
   difference, fit, "you can see it is 1.5 times bigger" — runs in a script in
   \`analysis/scripts/\`, not in the head and not in the reply text. The model reads
   the script's result; a number without the script that computed it is not a
   result.

## Verification instead of guessing

- **A path** only after checking (\`ls\`, \`test -f\`, reading the file). "Usually it
  lives in…" is forbidden; either the path is confirmed or you say it was not found.
- **A number** only from a file, a script or a log, with the path to the source.
  Values from the model's memory, "approximately", "should be about" — not a result.
- **Data** — before computing, look at what is really in the file: row count,
  columns, units, gaps. An answer built on an assumed file structure is an error,
  even a good-looking one.
- **A source reference** — an opened file. Citing by title without opening it is not
  allowed; a reference to a nonexistent artifact is an error too.
- **It did not work** — say exactly that: what you checked, what was not found,
  what you need from the owner. An empty gap is more honest than a plausible
  invention.

## How to proceed

- Read \`PROJECT.md\` first — it holds the question, the scope and the success
  criterion. If it is missing or empty, ask the owner instead of making it up.
- Agree on a multi-step plan before launching expensive calculations: a parameter
  sweep, a mesh, a series of runs is a separate decision with a cost estimate.
- Do not pass an assumption off as a result. Phrasings like "should be" and
  "usually" are allowed only when marked as a hypothesis.

## Forms

Ready-made forms: \`PROJECT.md\` (project), \`hypotheses/registry.md\` (hypotheses),
\`runs/README.md\` (run protocol), \`analysis/README.md\` (analysis),
\`paper/README.md\` (paper). Fill them in as you work, not at the end.
`

const README_MD = (projectName) => `# ${projectName}

Research project. Map of the directory and the order of work.

## Directory

| Path | What is inside | Rule |
| --- | --- | --- |
| \`PROJECT.md\` | project brief: question, scope, success criterion | filled in first |
| \`literature/\` | source cards, quotes, PDFs | one note per source |
| \`hypotheses/\` | registry of hypotheses and ideas | ID, status, what tested it |
| \`models/\` | setups, geometry, BCs, solver versions | the version is recorded |
| \`runs/\` | runs under the protocol | one run = one directory |
| \`data/raw/\` | source data | read-only |
| \`data/derived/\` | derived data | rebuilt by a script |
| \`analysis/\` | scripts, figures, tables | a figure = a script result |
| \`paper/\` | the paper and its figures | section = file |
| \`talks/\` | talks, presentations | — |
| \`admin/\` | reports, forms, applications | — |
| \`.dsh/\` | journal and provenance | do not edit by hand |

## Order of work

1. Fill in \`PROJECT.md\` (or have the agent put the questions to you).
2. Enter the hypotheses in \`hypotheses/registry.md\`.
3. Build the model/setup in \`models/\`, the run in \`runs/\`.
4. Work through the results in \`analysis/\`, recording the observations in the journal.
5. Assemble the paper in \`paper/\`.

## Journal

\`.dsh/notebook/<sessionId>.jsonl\` — hash-chained records; \`.dsh/provenance/\` —
where each file came from. The agent writes there through the \`notebook\` tool; read
and check with \`notebook_search\` and \`notebook_verify\`.
`

const PROJECT_MD = (projectName) => `# Project brief: ${projectName}

> Filled in before the first calculations. An empty item is an open question, not
> a detail: the agent must ask, not guess.

## 1. Question

- **Main research question:**
- **Why it matters (1–3 sentences):**
- **What is already known / what was checked earlier:**

## 2. Scope

- **What is in scope:**
- **What is deliberately out of scope:**
- **Assumptions we accept without checking:**

## 3. Hypotheses

| ID | Hypothesis | How we test it | What failure would mean |
| --- | --- | --- | --- |
| H-1 |  |  |  |
| H-2 |  |  |  |

## 4. Data

- **What the data is and where it comes from:**
- **Volume and format:**
- **Limitations (noise, gaps, range of validity):**

## 5. Model / rig

- **Solver, version, geometry:**
- **Boundary conditions and regime:**
- **Parameters we will vary (and why):**
- **Mesh and mesh-independence check:**

## 6. Result

- **What counts as success (numeric criteria):**
- **Which artifact must remain (table, figure, file):**
- **Who it is shown to, and where:**

## 7. Resources and schedule

- **Compute time and machines:**
- **Deadline / checkpoints:**
- **Budget for external computing (if any):**
`

const LITERATURE_README = `# Literature

One card per source — \`literature/notes/<year>-<first author>.md\`.
PDFs and links go to \`literature/refs/\` (or Zotero, in which case only the citekey is here).

## Source card

\`\`\`markdown
# <Author, year> — <short title>

- **Full reference / DOI:**
- **What it tests:** (one phrase)
- **Method:** (rig, solver, experiment)
- **Results:** (numbers with units, ranges)
- **Limitations:** (what it does not cover)
- **Why it is useful to us:** (which section / hypothesis it supports)
- **Quote for the paper:** (if a verbatim one is needed)
\`\`\`

## Registry

| Source | Year | Topic | Supports | Disagrees with | Citekey |
| --- | --- | --- | --- | --- | --- |
`

const HYPOTHESES_README = `# Hypothesis registry

A hypothesis without an ID and a status is an idea, not a hypothesis. A status
changes only together with the journal record that changes it.

| ID | Hypothesis (a testable statement) | Status | Test | Journal record | Date |
| --- | --- | --- | --- | --- | --- |
| H-1 |  | open |  |  |  |

Statuses: \`open\` → \`in progress\` → \`confirmed\` / \`refuted\` / \`deferred\`.

## Ideas that are not hypotheses yet

- (guesses, analogies, "what if" go here; when the status is raised the entry moves to the table)
`

const MODELS_README = `# Models and setups

One setup — one subdirectory: \`models/<model-version>/\`. The solver and mesh
version is recorded in \`setup.md\`, otherwise runs a month apart are not comparable.

## What to record in \`setup.md\`

- solver and version (\`ANSYS Fluent 2026 R1\`, \`OpenFOAM 14\`, build number);
- geometry and the source of the file, units;
- boundary conditions and initial values;
- turbulence/combustion/radiation model and its parameters;
- mesh: cell count, \`y+\`, mesh-independence check (a link to the report);
- scheme and relaxation/stability;
- known limitations and range of validity.
`

const RUNS_README = `# Run protocol

One run — one directory: \`runs/<date>-<short-name>/\`. A run that has no config
or no log does not exist: its result can be neither defended nor reproduced.

## Mandatory contents of a run directory

\`\`\`
runs/2026-11-27-baseline/
  run.md          # what and why: hypothesis, changed parameters, expectation
  config/         # configs, journal, case files (as they are)
  inputs/         # links to the input data (not copies of raw data)
  log             # raw solver log
  results/        # fields, CSV, reports
  conclusion.md   # what came out: numbers, whether it matched the expectation, what next
\`\`\`

## Minimum in \`run.md\`

- **Hypothesis / question of the run:** a reference to an ID from the registry;
- **What changed** relative to the previous run;
- **Expectation** (a number or a direction) — before the launch;
- **Stopping criterion** (convergence, time, budget).

## Minimum in \`conclusion.md\`

- numbers with units and paths to the files;
- whether it matched the expectation or not — and why;
- what to do next: another run, a different parameter, stop.
`

const ANALYSIS_README = `# Analysis

- code — \`analysis/scripts/<topic>.py\` (or \`.m\`, \`.jl\`); it starts with a single command;
- figures — \`analysis/figures/\`, name = what is shown + date, generated by a script;
- tables — \`analysis/tables/\`, CSV + a markdown version for the paper.

## Rules

1. A script reads \`runs/*/results\` or \`data/derived/\` — not \`data/raw/\`.
2. Every figure is reproducible: the script header says which data and which
   runs it uses.
3. Numbers in the paper text come from a table, they are not typed by hand.
4. An outlier and a rejected point are recorded in the journal: how many, why, and
   what that changes in the conclusion.
5. Any number someone will re-check is computed by a script: mean,
   difference, ratio, unit conversion, integral, fit. Mental arithmetic in a reply
   or in the paper text is a source of errors nobody will find.
`

const PAPER_README = (projectName) => `# Paper: ${projectName}

\`main.tex\` + \`sections/*.tex\`. Figures for the paper come only from
\`analysis/figures/\`, copied into \`paper/figures/\` together with the name of the
script that produced them.

## Plan

| Section | File | Status | Support (journal / runs) |
| --- | --- | --- | --- |
| Introduction | \`sections/intro.tex\` | no |  |
| Methods | \`sections/methods.tex\` | no |  |
| Results | \`sections/results.tex\` | no |  |
| Discussion | \`sections/discussion.tex\` | no |  |
| Conclusion | \`sections/conclusion.tex\` | no |  |

## Rules

- Methods is written from the journal and the run protocols, not from memory.
- Every claim in Results rests on a specific run or table.
- A figure enters the paper only together with the script that builds it.
`

const TALKS_README = `# Talks

One talk — one subdirectory: \`talks/<conference-year>/\` (slides, notes, the
abstract collection). Slides are assembled from the same figures as the paper: a
mismatch of numbers between the talk and the paper is an error, not formatting.
`

/**
 * Create the project infrastructure in `workspace`.
 *
 * Idempotent by contract: an existing file is never rewritten unless `force` is
 * set, so running the scaffold on a live project only reports what is missing.
 *
 * @returns {{ ok: true, workspace: string, project: string, created: string[], skipped: string[], folders: string[], marker: object }}
 */
export async function scaffoldResearchProject(workspace, options = {}) {
  const root = resolve(workspace)
  const markerPath = join(root, MARKER)
  const previous = readMarkerFile(markerPath)
  // A later call without a name must keep the one the project was created with:
  // re-deriving it from the directory name would silently rename the project.
  const givenName = typeof options.name === 'string' ? options.name.trim() : ''
  const projectName = givenName.length > 0 ? givenName : typeof previous?.name === 'string' && previous.name.length > 0 ? previous.name : guessProjectName(root)
  const created = []
  const skipped = []
  const updated = []
  const backedUp = []
  const folders = []

  for (const [relative] of FOLDERS) {
    const target = join(root, relative)
    if (existsSync(target)) {
      folders.push(relative)
      continue
    }
    await mkdir(target, { recursive: true })
    folders.push(relative)
    created.push(`${relative}/`)
  }

  const files = [
    ['AGENTS.md', AGENTS_MD],
    ['README.md', README_MD(projectName)],
    ['PROJECT.md', PROJECT_MD(projectName)],
    ['literature/README.md', LITERATURE_README],
    ['hypotheses/registry.md', HYPOTHESES_README],
    ['models/README.md', MODELS_README],
    ['runs/README.md', RUNS_README],
    ['analysis/README.md', ANALYSIS_README],
    ['paper/README.md', PAPER_README(projectName)],
    ['talks/README.md', TALKS_README],
  ]
  for (const [relative, content] of files) {
    const target = join(root, relative)
    if (existsSync(target) && options.force !== true) {
      skipped.push(relative)
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    // force is destructive to hand edits, so the previous text is kept beside it
    // (the same rule the journal repair follows: back up, then overwrite).
    if (existsSync(target)) {
      const backup = `${target}.bak-${Date.now()}`
      await copyFile(target, backup)
      backedUp.push(relative)
    }
    await writeFile(target, content, 'utf8')
    created.push(relative)
  }

  if (options.brief !== undefined && typeof options.brief === 'string' && options.brief.trim().length > 0) {
    const briefPath = join(root, 'PROJECT.md')
    const existing = existsSync(briefPath) ? readFileSync(briefPath, 'utf8') : ''
    const line = `\n## Question (from the request)\n\n${options.brief.trim()}\n`
    if (!existing.includes(options.brief.trim())) {
      await writeFile(briefPath, `${existing.trimEnd()}\n${line}`, 'utf8')
      // The report lists real paths only: a label like "PROJECT.md (question)" was
      // turned into a journal artifact and hashed as missing.
      if (existing.trim().length === 0) created.push('PROJECT.md')
      else updated.push('PROJECT.md')
    }
  }

  // Raw data is read-only by default: the guard already denies these paths
  // without a policy file, and writing the policy makes the intent visible.
  const policyPath = join(root, POLICY)
  if (!existsSync(policyPath)) {
    await mkdir(dirname(policyPath), { recursive: true })
    await writeFile(
      policyPath,
      `${JSON.stringify({ protectedPaths: ['data/raw/**', 'data/**'], allowPaths: ['data/derived/**', 'derived/**'], destructiveConfirm: true }, null, 2)}\n`,
      'utf8',
    )
    created.push(POLICY)
  } else {
    skipped.push(POLICY)
  }

  const marker = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'research-project',
    name: projectName,
    phase: typeof options.phase === 'string' ? options.phase : previous?.phase ?? 'setup',
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    brief: 'PROJECT.md',
    registry: 'hypotheses/registry.md',
    journal: '.dsh/notebook',
    provenance: '.dsh/provenance',
    folders: FOLDERS.map(([relative, purpose]) => ({ path: relative, purpose })),
  }
  await mkdir(dirname(markerPath), { recursive: true })
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
  created.push(MARKER)

  return { ok: true, workspace: root, project: projectName, created, skipped, updated, backedUp, folders, marker }
}

function guessProjectName(root) {
  const base = root.split(/[\\/]/).filter((part) => part.length > 0).pop()
  return typeof base === 'string' && base.length > 0 ? base : 'research project'
}

function readMarkerFile(path) {
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** workspace -> { at, marker } so the prompt section does not stat on every step. */
const identityCache = new Map()

function projectIdentity(workspace) {
  if (typeof workspace !== 'string' || workspace.length === 0) return undefined
  const hit = identityCache.get(workspace)
  if (hit !== undefined && Date.now() - hit.at < IDENTITY_TTL_MS) return hit.marker
  const markerPath = join(workspace, MARKER)
  let marker
  try {
    if (existsSync(markerPath) && statSync(markerPath).isFile()) marker = readMarkerFile(markerPath)
  } catch {
    marker = undefined
  }
  identityCache.set(workspace, { at: Date.now(), marker })
  return marker
}

/** One-line map of the project for the prompt. */
function identityText(marker) {
  const lines = [
    `research project: ${marker.name ?? 'untitled'} (phase: ${marker.phase ?? 'setup'})`,
    'this is a research project directory: the working rules are in AGENTS.md at the project root, the brief is in PROJECT.md; if PROJECT.md is empty, ask the owner instead of guessing.',
    'map: literature/ (sources) hypotheses/ (registry) models/ (setups) runs/ (runs under the protocol) data/raw (read-only) data/derived analysis/ (scripts, figures, tables) paper/ talks/ admin/',
    'journal discipline: hypothesis and method before a run, observation with numbers/units/artifact path after it, decision with its reason; never rewrite archived data.',
    'do not invent: check paths and data (ls/test/read), take numbers from a file or a log; any computation goes in a script under analysis/scripts/, not in the head; when something is missing, say "not found".',
  ]
  return lines.join('\n')
}

export function apply(ctx, config) {
  const workspaceOf = (exec) => activeWorkspace(ctx, exec, config)
  const workspaceOfAgent = async (agent) => {
    const fromHeader = sessionWorkspace(ctx, agent?.id)
    if (fromHeader !== undefined) return fromHeader
    return activeWorkspace(ctx, { agent }, config)
  }

  if (typeof ctx.systemPrompt?.section === 'function') {
    ctx.systemPrompt.section({
      name: 'research-project-identity',
      order: 55,
      text: (context) => {
        const agent = context?.agent ?? context?.scope
        const workspace = agent !== undefined && typeof agent?.id === 'string' ? sessionWorkspace(ctx, agent.id) : undefined
        const marker = projectIdentity(workspace ?? '')
        if (marker === undefined) return ''
        return identityText(marker)
      },
    })
  }

  ctx.tools.register({
    name: 'research_init',
    description:
      'Turn a directory into a research project: creates the folder layout (literature, hypotheses, models, runs, data/raw, data/derived, analysis, paper, talks, admin), the forms (PROJECT.md brief, hypotheses/registry.md, run protocol, analysis and paper rules), AGENTS.md with the project rules, a guard policy protecting raw data, and the .dsh/research-project.json marker that makes every later session treat this directory as a research project. Idempotent: existing files are kept unless force is true.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name (default: directory name).' },
        brief: { type: 'string', description: 'One-line research question to seed PROJECT.md.' },
        path: { type: 'string', description: 'Project directory (default: the session workspace).' },
        force: { type: 'boolean', description: 'Rewrite the forms even when they exist (destructive to edits).' },
      },
    },
    output: {
      schema: { type: 'object' },
      render(args, value) {
        if (value?.ok !== true) return [{ type: 'text', text: `research_init: ${value?.error ?? 'failed'}` }]
        const lines = [`research project ready: ${value.project} (${value.workspace})`]
        lines.push(`folders: ${value.folders.length}`)
        if (value.created.length > 0) lines.push(`created: ${value.created.join(', ')}`)
        if (value.updated.length > 0) lines.push(`updated: ${value.updated.join(', ')}`)
        if (value.backedUp.length > 0) lines.push(`backed up before force: ${value.backedUp.join(', ')}`)
        if (value.skipped.length > 0) lines.push(`kept as-is: ${value.skipped.join(', ')}`)
        lines.push('next: fill PROJECT.md and hypotheses/registry.md, then work through runs/ and analysis/.')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const requested = typeof args?.path === 'string' && args.path.trim().length > 0 ? args.path.trim() : undefined
      const base = await workspaceOf(exec)
      const workspace = requested === undefined ? base : isAbsolute(requested) ? requested : resolve(base, requested)
      // The same rule the survey and the panels follow: this plugin writes inside
      // the project the session works in, never into an arbitrary directory that
      // came in as a tool argument.
      if (workspace !== base && !workspace.startsWith(`${base}${sep}`)) {
        return {
          ok: false,
          error: `research_init builds a project inside the session workspace (${base}); ${workspace} is outside it`,
          workspace,
        }
      }
      const report = await scaffoldResearchProject(workspace, { name: args?.name, brief: args?.brief, force: args?.force === true })
      try {
        await appendAutoNote(workspace, {
          sessionId: exec?.agent?.id ?? 'global',
          toolName: 'research_init',
          stepId: String(exec?.callId ?? 'scaffold'),
          artifacts: report.created.filter((entry) => !entry.endsWith('/')).map((path) => ({ path })),
        })
      } catch {
        /* the journal note is a convenience; the scaffold itself succeeded */
      }
      return report
    },
  })

  const commands = getService(ctx, 'commands')
  if (typeof commands?.register === 'function') commands.register({
    name: 'research-init',
    description: 'Create the research project infrastructure in this directory (folders, forms, AGENTS.md, journal marker)',
    input: { hint: '[project name]' },
    async handler(invocation) {
      try {
        const workspace = await workspaceOfAgent(invocation.agent)
        const name = invocation.rawInput.trim()
        const report = await scaffoldResearchProject(workspace, name.length > 0 ? { name } : {})
        try {
          await appendAutoNote(workspace, {
            sessionId: invocation.agent?.id ?? 'global',
            toolName: '/research-init',
            stepId: 'scaffold',
            artifacts: report.created.filter((entry) => !entry.endsWith('/')).slice(0, 40).map((path) => ({ path })),
          })
        } catch {
          /* the journal note is a convenience; the scaffold itself succeeded */
        }
        const parts = [`research project "${report.project}" ready: ${report.workspace}`]
        parts.push(`folders: ${report.folders.length}, files created: ${report.created.filter((entry) => !entry.endsWith('/')).length}`)
        if (report.updated.length > 0) parts.push(`updated: ${report.updated.join(', ')}`)
        if (report.backedUp.length > 0) parts.push(`backed up before overwrite: ${report.backedUp.join(', ')}`)
        if (report.skipped.length > 0) parts.push(`kept as-is: ${report.skipped.join(', ')}`)
        parts.push('next: fill in PROJECT.md and hypotheses/registry.md, then work through runs/ and analysis/.')
        return { kind: 'success', text: parts.join('\n') }
      } catch (error) {
        return { kind: 'error', text: `research-init: ${String(error?.message ?? error)}` }
      }
    },
  })
}

export default { name, inject, apply }
