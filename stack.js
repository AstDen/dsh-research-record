/**
 * The recommended research stack.
 *
 * Data plus renderers; this module never installs anything. `/research-stack`
 * prints what to add and why, with the exact command to paste, so a reader
 * decides — an agent that silently installs eleven packages into someone's
 * profile is not a service.
 *
 * Every entry was checked against the registry (version, licence, engines.dsh,
 * Linux support read from the code) on the `verified` date. Anything not checked
 * is marked NOT VERIFIED in `note` instead of being presented as fact.
 */

/** core = the work is crippled without it; optional = clear gain for a common task;
 *  situational = only for one task shape; avoid = known trap, do not install. */
import { spawn } from 'node:child_process'
import { getService } from './services.js'

export const STACK = [
  {
    id: 'record',
    title: 'Scientific record',
    level: 'core',
    verified: '2026-11-27',
    why: 'Hypothesis journal with a hash chain, file provenance, a guard on raw data. Without it, a month later nobody remembers where a number came from.',
    packages: [],
    note: 'This bundle (research-record). Already installed.',
  },
  {
    id: 'literature',
    title: 'Literature, Zotero, BibTeX',
    level: 'core',
    verified: '2026-11-27',
    why: 'Read your own library and full texts, get BibTeX from a DOI, search book passages in a RAG store — without copying references by hand.',
    packages: ['dsh-zotero-local@0.4.0', 'dsh-cite@0.13.1', 'dsh-kb-rag'],
    install: 'dsh plugin --profile web add dsh-zotero-local dsh-cite dsh-kb-rag',
    conflicts: 'One Zotero reader per profile: dsh-zotero-local, dsh-zotero and dsh-plugin-zotero overlap in tool names and write to the same library.',
    note: 'dsh-zotero-local reads the local Zotero API (23119), including full text and annotations: 17 tools, 0 peers, 368 KB. Without the zotero-integrated-mcp add-on on 23120, dsh-plugin-zotero can only write notes — as the only Zotero plugin it is useless.',
  },
  {
    id: 'latex',
    title: 'LaTeX: build it and see the page',
    level: 'core',
    verified: '2026-11-27',
    why: 'Compile, render a page, SyncTeX (source line ↔ place on the page), diff against the previous version. You see the error with your eyes, not in the log.',
    packages: ['@fffangchenghao/dsh-latex-look@0.4.5'],
    install: 'dsh plugin --profile web add @fffangchenghao/dsh-latex-look',
    note: 'Needs TeX Live (xelatex) and Ghostscript. Cyrillic: fontspec + polyglossia; fontenc T2A under xelatex silently drops Russian letters. Citation audit (dsh-latex-guard) is separate: the installer requires a version exemption for 0.2.2-rc.5.',
  },
  {
    id: 'pdf',
    title: 'Reading PDF page by page',
    level: 'core',
    verified: '2026-11-27',
    why: 'Outline, text and search over specific pages, render a region to an image — instead of pulling a whole PDF into the context.',
    packages: ['dsh-pdf-tools@0.1.0'],
    install: 'dsh plugin --profile web add dsh-pdf-tools',
    conflicts: 'Do not install together with dsh-pdf-formula: both register the pdf_info tool.',
    note: 'No system binaries needed (canvas is prebuilt). Does not read scans without a text layer: there is no local OCR in the ecosystem.',
  },
  {
    id: 'tables',
    title: 'Tables, data from PDF',
    level: 'core',
    verified: '2026-11-27',
    why: 'Dataset profile, cleaning with an audit trail, rule checks — and tables from PDF locally, without the cloud.',
    packages: ['dsh-data-quality@0.3.30', 'dsh-table-ingest@0.2.6', 'dsh-pdf-table@0.2.2'],
    install: 'dsh plugin --profile web add dsh-data-quality dsh-table-ingest dsh-pdf-table',
    note: 'dsh-pdf-table works off the text layer: it cannot handle a scan without OCR. There is no local OCR plugin in the ecosystem.',
  },
  {
    id: 'documents',
    title: 'Documents and presentations',
    level: 'optional',
    verified: '2026-11-27',
    why: 'A talk as HTML slides and as .pptx, docx editing with tracked revisions; a report in docx/xlsx.',
    packages: ['revealjs-generate', 'dsh-pptx-builder@1.1.0', 'dsh-docx-redline@0.2.2'],
    install: 'dsh plugin --profile web add revealjs-generate dsh-pptx-builder dsh-docx-redline',
    conflicts: 'No more than two deck generators: revealjs (HTML) + pptx-builder (.pptx). office-pptx from the built-in skills is for editing, not for building from scratch.',
    note: 'docx/xlsx/pptx come with the office-* skills; no extra docx editor is needed.',
  },
  {
    id: 'statistics',
    title: 'Statistics and reproducibility checks',
    level: 'optional',
    verified: '2026-11-27',
    why: 'Recompute "t(df)=…, p=…" from the article text; a reproducibility manifest (commit, lockfile, seeds, data hashes).',
    packages: ['@perrylink/dsh-research-core@0.1.6', 'dsh-statcheck@0.1.4', 'dsh-repro-audit@0.1.6'],
    install: 'dsh plugin --profile web add @perrylink/dsh-research-core dsh-statcheck dsh-repro-audit',
    note: 'dsh-statcheck imports research-core hard: install only as a pair. Then, optionally, dsh-manuscript-check (manuscript), dsh-sr-ledger (review), dsh-retraction-watch (retracted papers, needs network).',
  },
  {
    id: 'fluent',
    title: 'ANSYS Fluent',
    level: 'situational',
    local: true,
    verified: '2026-11-27',
    why: 'Task interview → journal → run Fluent → parse the transcript → report. There are no other Fluent plugins in the DSH registry at all.',
    packages: ['fluent-case-builder@0.6.0'],
    install: 'cd <path to fluent-case-builder> && dsh plugin --profile web add "$PWD"',
    note: 'Installed as a local path (link), not from the registry. Needs Fluent (v261) installed and a live licence.',
  },
  {
    id: 'openfoam',
    title: 'OpenFOAM: case, mesh, verification',
    level: 'situational',
    verified: '2026-11-27',
    why: 'Full cycle: dictionaries, snappy/cfMesh/gmsh mesh, run, convergence check, field rendering.',
    packages: ['@yakovlev-i-a/dsh-openfoam-workbench@0.9.32', 'mesh-toolkit@1.3.1'],
    install: 'dsh plugin --profile web add @yakovlev-i-a/dsh-openfoam-workbench mesh-toolkit',
    conflicts: 'Do NOT install together with @bushizhanghan/dsh-openfoam-doctor: it calls wsl.exe and does not work on Linux, and its 6 tools duplicate workbench.',
    note: 'mesh-toolkit reads sim-project.json upwards from cwd: run it from the project root. cfMesh exists only in the com build of OpenFOAM.',
  },
  {
    id: 'hpc',
    title: 'Compute on other machines',
    level: 'situational',
    verified: '2026-11-27',
    why: 'SSH workspaces on cluster hosts: run a command, fetch a file, forward a port — without leaving the chat.',
    packages: ['dsh-remote@1.5.0'],
    install: 'dsh plugin --profile web add dsh-remote',
    note: 'There is no queue scheduler (Slurm/sbatch) in the ecosystem: dsh-remote gives rw_exec, corewatch-mcp only monitors. dsh-scnet does not fit: it is about SCNet.',
  },
  {
    id: 'infra',
    title: 'Working infrastructure',
    level: 'optional',
    verified: '2026-11-27',
    why: 'Search across past sessions, parallel lines of work with tasks, cost tracking.',
    packages: ['@deepseek-ai/dsh-experimental-session-search', '@nanmicoder/dsh-agent-teams@0.1.31', 'dsh-cost-meter'],
    install: 'dsh plugin --profile web add @deepseek-ai/dsh-experimental-session-search @nanmicoder/dsh-agent-teams dsh-cost-meter',
    conflicts: 'Do not install the community plugin dsh-session-search 0.1.1: its engines.dsh ends at 0.2.1-rc.1.',
    note: 'The official session-search already covers history search; agent-teams is needed when work runs along parallel lines.',
  },
]

/** Packages known to break or disappoint, with the reason. */
export const AVOID = [
  {
    packages: ['@bushizhanghan/dsh-openfoam-doctor'],
    reason: 'Calls wsl.exe and rejects non-WSL paths — on Linux its tools do not register at all; the function is covered by openfoam-workbench.',
  },
  {
    packages: ['dsh-session-search@0.1.1'],
    reason: 'engines.dsh ends at 0.2.1-rc.1; installing it on 0.2.2-rc.5 breaks the profile.',
  },
  {
    packages: ['@kikulmj/dsh-jupyter'],
    reason: 'Registers a tool named python — a clash with any python plugin and with the model.',
  },
  {
    packages: ['@copylee/dsh-office'],
    reason: 'office_render/office_read collide with the names of the built-in office skill; on top of that it requires Windows and MS Office.',
  },
  {
    packages: ['dsh-pptx-sidebar', 'dsh-docx-sidebar'],
    reason: 'engines.dsh <0.2.1 — incompatible with the current version.',
  },
  {
    packages: ['dsh-office-kit', 'dsh-pptx-studio'],
    reason: 'Verified on Windows only (capability file/render through PowerShell); pull in a dozen pip packages.',
  },
  {
    packages: ['dsh-typst', 'dsh-typst-plugin'],
    reason: 'There is no typst binary on the host; without it the first hands back an uncompiled .typ and the second brings 34 peer dependencies for a UI.',
  },
  {
    packages: ['dsh-pdf-formula'],
    reason: 'Registers pdf_info, just like dsh-pdf-tools: the second plugin dies on the duplicate name. Install one of the two.',
  },
  {
    packages: ['dsh-latex-studio', 'dsh-latex-tools', 'dsh-latex-editor'],
    reason: 'studio is a third compiler in the same directory and writes .bib in place; tools and editor provide no model-facing tools for science.',
  },
  {
    packages: ['dsh-zotero', '@hanxu131/dsh-zotero'],
    reason: 'dsh-zotero pulls 17 dependencies and 30 MB, reading zotero.sqlite while Zotero is running (risk of locks); @hanxu131 requires dsh >=0.2.3-alpha.2 and will not install on 0.2.2-rc.5.',
  },
  {
    packages: ['@ggboy123/dsh-paper-reader', '@eduwork/dsh-literature', '@shlv/dsh-literature', '@zhe_xuan/dsh-paper-desk'],
    reason: 'Either superseded (paper-reader-evidence instead of paper-reader), or they share the literature_* tool names, or pull 11 @deepseek-ai peers, or introduce a second library next to Zotero.',
  },
  {
    packages: ['dsh-pdf-mineru'],
    reason: 'Requires the cloud MinerU (API key) or a self-hosted service — not offline.',
  },
]

/** What the ecosystem does not have, so nobody searches twice. */
export const GAPS = [
  'Figure quality checks (fonts, DPI, colorblind palette, "redraw figure 3") — not a single package.',
  'matplotlib/plotly/vega wrappers with scientific palettes — none; dsh-chart draws its own SVG for draft figures.',
  'Markdown/HTML → PDF — none; there is Office→PDF (alpha) and Typst→PDF (needs the binary).',
  'Local OCR for scans — none; tesseract.js exists only inside a CLI, not as a plugin.',
  'Writing annotations into the PDF file itself — none; every plugin keeps them in its own database.',
  'A single .bib manager with locking and Zotero sync — none.',
  'Slurm/job queue, gmsh, ParaView, Cantera, COMSOL, HDF5 as plugins — none.',
  'Fluent and CFD as a category — zero packages in the registry (13 445 records); fluent-case-builder exists only as a local path.',
  'A "Zotero MCP" bridge as a DSH plugin — none: port 23120 is served by the Zotero add-on, and the zotero-mcp npm packages are plain MCP servers.',
]

/** Task -> tool routing: which installed plugin answers which question. */
export const ROUTING = [
  [
    'An existing project: learn what sits where before changing anything',
    'project_survey (map and facts) → project_adopt (three modes) → migrate one item at a time with a decision',
    ['project_survey', 'project_adopt'],
  ],

  // [task, how it is done, tools this bundle expects to exist]
  //
  // The third column is explicit because the second one is prose: parsing tool
  // names out of "a script in analysis/scripts/ → an artifact in analysis/figures"
  // produced advice about tools that do not exist. A row with `[]` is script
  // work with no tool of its own, and the usage report skips it instead of
  // reporting it as an unused capability.
  ['PDF: pages, a section, a quotation, a table', 'pdf_info → pdf_outline/pdf_search → pdf_text; tables pdf_tables/pdf_to_csv; a scan pdf_render',
    ['pdf_info', 'pdf_outline', 'pdf_search', 'pdf_text', 'pdf_tables', 'pdf_to_csv', 'pdf_render']],
  ['Zotero: what is there, what a paper is about, annotations', 'zotero_search → zotero_digest/zotero_retrieve/zotero_fulltext; zotero_annotations; zotero_export',
    ['zotero_search', 'zotero_digest', 'zotero_retrieve', 'zotero_fulltext', 'zotero_annotations', 'zotero_export']],
  ['references and .bib: find, format, check', 'cite_lookup, cite_format, cite_bibtex, cite_check, cite_batch',
    ['cite_lookup', 'cite_format', 'cite_bibtex', 'cite_check', 'cite_batch']],
  ['tables and data: profile, quality, cleaning', 'data_profile, data_verify, data_clean; xlsx/docx/csv → table_ingest',
    ['data_profile', 'data_verify', 'data_clean', 'table_ingest']],
  ['statistics in a manuscript and reproducibility', 'stat_check, stat_recompute; repro_manifest → repro_check → repro_card',
    ['stat_check', 'stat_recompute', 'repro_manifest', 'repro_check', 'repro_card']],
  ['any number and any figure', 'a script in analysis/scripts/ → an artifact in analysis/figures or runs/<id>/results', []],
  ['a paper: text edits and how the page looks', 'latex_look (compile + render + SyncTeX + diff)', ['latex_look']],
  ['a presentation', 'pptx_create → pptx_add_slide(template) → pptx_add_chart/pptx_add_math/pptx_add_image',
    ['pptx_create', 'pptx_add_slide', 'pptx_add_chart', 'pptx_add_math', 'pptx_add_image']],
  ['.docx: structure, editing, version comparison', 'doc_inspect → doc_replace_text / redline_diff / doc_change_summary',
    ['doc_inspect', 'doc_replace_text', 'redline_diff', 'doc_change_summary']],
  ['CFD: case, mesh, run, fields', 'openfoam_* (workbench), fluent_case_* (Fluent), mesh_build / mesh_check / stl_*',
    ['openfoam_run', 'openfoam_check', 'fluent_case_run', 'mesh_build', 'mesh_check']],
  ['journal and provenance', 'notebook, notebook_search, notebook_verify, provenance_of_file, provenance_verify',
    ['notebook', 'notebook_search', 'notebook_verify', 'provenance_of_file', 'provenance_verify']],
]

/** Render the routing table as plain text. */
export function renderRoutes() {
  return ROUTING.map((row) => '· ' + row[0] + ' → ' + row[1]).join('\n')
}

/** Quote a spec only when it needs it, so the printed command stays copy-pasteable. */
export function shellQuote(spec) {
  const text = String(spec)
  return /^[A-Za-z0-9@._/~+=:,^-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`
}

/** Install command for a list of packages. */
export function installCommand(packages, profile = 'web') {
  return `dsh plugin --profile ${profile} add ${packages.map(shellQuote).join(' ')}`
}

const LEVEL_MARK = { core: '●', optional: '○', situational: '◌' }

function renderEntry(entry) {
  const lines = [`${LEVEL_MARK[entry.level]} ${entry.title} [${entry.id}]`, `   ${entry.why}`]
  if (entry.packages.length > 0) lines.push(`   $ ${entry.install}`)
  if (entry.note !== undefined) lines.push(`   ⓘ ${entry.note}`)
  if (entry.conflicts !== undefined) lines.push(`   ⚠ ${entry.conflicts}`)
  return lines.join('\n')
}

/** Render the stack as plain text for a chat command. */
export function renderStack({ level } = {}) {
  const everyLevel = level === undefined || level === 'all'
  const items = STACK.filter((entry) => (everyLevel ? true : entry.level === level))
  const blocks = items.map(renderEntry)
  if (everyLevel) {
    blocks.push(`✕ Do not install\n${AVOID.map((item) => `   ${item.packages.join(', ')} — ${item.reason}`).join('\n')}`)
    blocks.push(`∅ Missing from the ecosystem\n${GAPS.map((gap) => `   · ${gap}`).join('\n')}`)
  }
  blocks.push('● required · ○ clear gain · ◌ for a specific task')
  blocks.push(`Checked against the registry: ${[...new Set(STACK.map((entry) => entry.verified))].sort().pop()}`)
  return blocks.join('\n\n')
}

/** Package name without its pinned version (`@scope/name@1.2.3` → `@scope/name`). */
export function packageName(spec) {
  const at = spec.lastIndexOf('@')
  return at > 0 ? spec.slice(0, at) : spec
}

/** Every package mentioned anywhere in the stack, for a "what is missing" check. */
export function allPackages() {
  return STACK.flatMap((entry) => entry.packages.map(packageName))
}

export const name = 'research-record-stack'
export const inject = ['tools', 'commands', 'systemPrompt']

const PROMPT_TEXT =
  'Research stack. /research-stack lists the recommended plugins by level (core/optional/situational), what not to install and what the ecosystem does not have; the research_stack tool does the same (action "show") and installs one chosen level (action "install", confirm:true; without confirm it only prints the command). Task → tool:\n' +
  renderRoutes() +
  '\nRule: if a task matches a row above, use that tool, not a bash parser or a hand-rolled script. If the tool set does not have the right tool — say so and point to /research-stack (install) instead of inventing a workaround.'

/** Packages of one level ('all' = every level), registry specs only. */
export function packagesForLevel(level) {
  const wanted = level === 'all' || level === undefined ? undefined : level
  return STACK.filter((entry) => wanted === undefined || entry.level === wanted)
    .filter((entry) => entry.local !== true)
    .flatMap((entry) => entry.packages.map(packageName))
}

/** Entries installed from a local checkout: a name is not enough to install them. */
export function localEntriesFor(level) {
  const wanted = level === 'all' || level === undefined ? undefined : level
  return STACK.filter((entry) => (wanted === undefined || entry.level === wanted) && entry.local === true)
}

export function levelOf(level) {
  return ['core', 'optional', 'situational', 'all'].includes(level) ? level : undefined
}

/** Run `dsh plugin --profile <profile> add <packages>` and capture its output. */
function runAdd(packages, profile, timeoutMs = 900000) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('dsh', ['plugin', '--profile', profile, 'add', ...packages], {
        cwd: process.env.HOME ?? process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ code: 'spawn-error', output: String(error?.message ?? error) })
      return
    }
    let out = ''
    const push = (chunk) => {
      out = (out + chunk).slice(-20000)
    }
    child.stdout.on('data', push)
    child.stderr.on('data', push)
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      resolve({ code: 'timeout', output: out })
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: 'spawn-error', output: String(error?.message ?? error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output: out })
    })
  })
}

export function apply(ctx, config) {
  const defaultProfile = typeof config?.profile === 'string' ? config.profile : 'web'
  const commands = getService(ctx, 'commands')
  if (typeof commands?.register === 'function') {
    commands.register({
      name: 'research-stack',
      description: 'Recommended plugin stack for scientific work',
      input: { hint: '[core|optional|situational|routes]' },
      handler(invocation) {
        const raw = String(invocation?.rawInput ?? '').trim().toLowerCase()
        if (raw === 'routes') return { kind: 'success', text: renderRoutes() }
        return { kind: 'success', text: renderStack({ level: levelOf(raw) }) }
      },
    })
  }

  if (typeof ctx.systemPrompt?.section === 'function') {
    ctx.systemPrompt.section({ name: 'research-stack', order: 56, text: PROMPT_TEXT })
  }

  if (typeof ctx.tools?.register !== 'function') return
  ctx.tools.register({
    name: 'research_stack',
    description:
      'Recommended scientific plugin stack: action="show" lists the levels (core/optional/situational) with the exact install command, plus what not to install and what does not exist; action="install" runs `dsh plugin --profile <profile> add` for one level — it prints the command and changes nothing unless confirm:true. Levels: core (should be installed), optional (clear gain), situational (only for a specific task).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'install'], description: 'show (default) or install.' },
        level: {
          type: 'string',
          enum: ['core', 'optional', 'situational', 'all'],
          description: 'Which level. show defaults to all; install defaults to core.',
        },
        confirm: { type: 'boolean', description: 'Required for install: without it the tool only returns the command.' },
        profile: { type: 'string', description: 'DSH profile name (default: config.profile or web).' },
      },
    },
    output: {
      schema: { type: 'object' },
      render(args, value) {
        const text = String(value?.text ?? 'research_stack: no output')
        return [{ type: 'text', text }]
      },
    },
    async execute(args) {
      const action = args?.action === 'install' ? 'install' : 'show'
      const profile = typeof args?.profile === 'string' && args.profile.length > 0 ? args.profile : defaultProfile
      const level = levelOf(args?.level)
      if (action === 'show') return { ok: true, text: renderStack({ level }) }

      const chosen = level ?? 'core'
      const packages = packagesForLevel(chosen)
      const locals = localEntriesFor(chosen)
      const manual = locals.map((entry) => `# ${entry.title}\n${entry.install}`).join('\n')
      if (packages.length === 0) {
        return locals.length === 0
          ? { ok: false, text: 'research_stack: no packages for level "' + chosen + '"' }
          : {
              ok: true,
              local: locals.map((entry) => entry.id),
              text:
                'research_stack: this level is installed from a local path, the registry does not have it.\n' +
                manual +
                '\nA human performs the install: only they know the directory path.',
            }
      }
      const command = installCommand(packages, profile)
      if (args?.confirm !== true) {
        return {
          ok: true,
          text: 'research_stack: nothing changed (confirm:true is required).\n' + command + '\nPackages: ' + packages.join(', '),
        }
      }
      const result = await runAdd(packages, profile)
      const tail = String(result.output ?? '').trim().split('\n').slice(-12).join('\n')
      const failed = result.code !== 0
      const ro = /EROFS|EACCES|read-only/i.test(String(result.output ?? ''))
      const note = failed
        ? ro
          ? '\n\nThe profile lives outside the working folder: a sandboxed process cannot write into it. Run the command in a terminal or switch /permission danger-full-access and repeat.'
          : '\n\nThe command failed — see the output above.'
        : '\n\nDone. New tools appear in the set when the profile loads: refresh the page and, if the set has not changed, restart DSH.'
      const manualNote = locals.length > 0 ? `\n\nLocal ones (not from the registry) — separately:\n${manual}` : ''
      return { ok: !failed, code: result.code, text: command + '\n\n' + tail + note + manualNote, local: locals.map((entry) => entry.id) }
    },
  })
}
