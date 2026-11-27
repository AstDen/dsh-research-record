# Recommended stack for research work

`research-record` gives you the scientific record: a hypothesis journal, file
provenance, a guard on raw data, a project skeleton and two rules (`do not invent`
and `compute it in a script`). Everything else — reading literature, typesetting a
paper, tables, computation — comes from separate plugins. This file says which ones
to install, in what order, and what to avoid. Nothing is installed automatically:
every line is a command you run yourself.

Checked against the npm registry and the package code on **2026-11-27** (DSH 0.2.2-rc.5,
Debian, TeX Live 2023, Fluent v261, OpenFOAM com/org, Zotero with the local API on
23119). Versions are pinned to that day; the installer itself will refuse to install
what does not fit your DSH version.

Quick look from the chat: `/research-stack` (all levels), `/research-stack core`
(required only), `/research-stack optional`, `/research-stack situational`,
`/research-stack routes` (which task is solved by which tool).

Install the same way, without copying commands out of this file: ask the agent to
"install the recommended stack" — it calls the `research_stack` tool with a level.
The tool **does nothing without `confirm: true`**: first it prints the exact command.
With `confirm: true` it runs `dsh plugin --profile web add …` and returns the output;
if the profile is closed off by the sandbox (`EROFS`), it says so and offers the
terminal or `/permission danger-full-access`.

## Levels

| Mark | Level | What it means |
| --- | --- | --- |
| ● | core | without it research work in DSH is incomplete: literature, paper, data |
| ○ | optional | clear gain for a typical task, but you can live without it |
| ◌ | situational | only if the task is exactly that (Fluent, OpenFOAM, a cluster) |
| ✕ | do not install | known to break or disappoint — and why |

## ● Required

### Literature, Zotero, BibTeX

```bash
dsh plugin --profile web add dsh-zotero-local dsh-cite dsh-kb-rag
```

- `dsh-zotero-local` 0.4.0 — 17 tools: collections, search, PDF full text, notes,
  annotations, export. Works with the local Zotero API (port 23119), needs no add-ons,
  has no dependencies, 368 KB.
- `dsh-cite` 0.13.1 — BibTeX from a DOI (Crossref), deduplication, key checks.
  Keeps its own store and writes `.bib` only on export, so it does not fight LaTeX.
- `dsh-kb-rag` — RAG over local PDFs and books: `kb_ingest`, `kb_rag`, `kb_search`.

One Zotero reader per profile. `dsh-plugin-zotero` (panel + note writing) can read
only through the `zotero-integrated-mcp` add-on on port 23120; without the add-on it
is 5 write tools and zero reading, so as the only Zotero plugin it does not fit.

### LaTeX: build it and see the page

```bash
dsh plugin --profile web add @fffangchenghao/dsh-latex-look
```

`latex_look` compiles (xelatex/lualatex/pdflatex/latexmk), renders a page to an
image, finds the source line by text on the page (SyncTeX) and shows the diff with
the previous build. Needs TeX Live and Ghostscript.

Cyrillic: `fontspec` + `polyglossia`, not `fontenc T2A` — under xelatex the latter
silently drops Russian letters (blank spots remain in the PDF, the log has only a
warning).

`dsh-latex-guard` (`\cite` audit against `.bib`) is a separate decision: on 0.2.2-rc.5
the installer requires a version exemption, because the plugin declares
`@deepseek-ai/dsh-tools ^0.1.1-rc.1`.

### Tables and data

```bash
dsh plugin --profile web add dsh-data-quality dsh-table-ingest dsh-pdf-table
```

- `dsh-data-quality` — dataset profile, cleaning with an audit trail, rule checks,
  a report (`data_profile`, `data_clean`, `data_verify`, `data_report`).
- `dsh-table-ingest` — a table from docx/xlsx/csv into JSON for checks.
- `dsh-pdf-table` — tables from PDF via the text layer, into CSV with a sha256.

`dsh-pdf-table` cannot handle a scan without a text layer: there is no local OCR in
the ecosystem.

### Reading PDF page by page

```bash
dsh plugin --profile web add dsh-pdf-tools
```

`pdf_info`, `pdf_outline`, `pdf_text`, `pdf_search`, `pdf_render` — read the pages you
need and render a region to an image instead of pulling a whole PDF into the context.
No system binaries needed. Do not install together with `dsh-pdf-formula`: both
register `pdf_info`.

## ○ Clear gain

### Documents and presentations

```bash
dsh plugin --profile web add revealjs-generate dsh-pptx-builder dsh-docx-redline
```

- `revealjs-generate` — HTML slides (themes, fragments, speaker notes).
- `dsh-pptx-builder` 1.1.0 — .pptx from scratch, its own OOXML, maths without LaTeX,
  0 dependencies and 0 peers. The cleanest pptx path in the registry.
- `dsh-docx-redline` 0.2.2 — per-part SHA-256, 13 structural counters, a line-by-line
  diff of docx versions: manuscript revision.

docx/xlsx/pptx are created and read by the built-in `office-*` skills plus
LibreOffice (`office_render`, `office_convert`). A second docx editor is not needed.

### Statistics and reproducibility checks

```bash
dsh plugin --profile web add @perrylink/dsh-research-core dsh-statcheck dsh-repro-audit
```

- `@perrylink/dsh-research-core` 0.1.6 — REP v1: the schema "source → snapshot →
  evidence → claim → verdict". The base for the packages below.
- `dsh-statcheck` 0.1.4 — recomputes `t(df)=…, p=…` from the paper text and shows the
  exact character ranges; a SARIF report.
- `dsh-repro-audit` 0.1.6 — reproducibility manifest: git commit and dirtiness,
  lockfiles, environment pins, hashes of data and figures, seeds; drift checking.

`dsh-statcheck` imports `research-core` hard (not as an optional peer) — install only
as a pair. Then, optionally: `dsh-manuscript-check` (manuscript sections and
CONSORT/STROBE/PRISMA checklists), `dsh-sr-ledger` (systematic review, PRISMA flow),
`dsh-retraction-watch` (retracted papers; needs network).

### Working infrastructure

```bash
dsh plugin --profile web add @deepseek-ai/dsh-experimental-session-search @nanmicoder/dsh-agent-teams dsh-cost-meter
```

Search across past sessions, parallel lines of work with a task DAG and quality
gates, money tracking per request. Do not install the community plugin
`dsh-session-search` 0.1.1: its `engines.dsh` ends at `0.2.1-rc.1`.

## ◌ For a specific task

### ANSYS Fluent

```bash
cd <path to fluent-case-builder> && dsh plugin --profile web add "$PWD"
```

`fluent_case_interview` → `fluent_case_plan` → `fluent_case_generate` →
`fluent_case_run` → `fluent_case_status`, plus a TUI knowledge base and a report for
the maintainer. There are no other Fluent plugins in the DSH registry at all (0 hits
in 13 445 records) — this is a local package, not a registry one.

### OpenFOAM: case, mesh, verification

```bash
dsh plugin --profile web add @yakovlev-i-a/dsh-openfoam-workbench mesh-toolkit
```

`dsh-openfoam-workbench` 0.9.32 — 65 tools and 11 skills: dictionaries, a case,
running, convergence checks, field rendering, source search, experience cards.
`mesh-toolkit` 1.3.1 — STL → mesh (snappy/cfMesh/gmsh) → quality gate → delivery to
OpenFOAM and to Fluent `.msh`.

**Do not install** `@bushizhanghan/dsh-openfoam-doctor`: it calls `wsl.exe` and rejects
non-WSL paths, on Linux its tools do not register at all, and its six functions are
fully covered by workbench.

`mesh-toolkit` looks for `sim-project.json` upwards from the current directory — run
it from the project root. cfMesh exists only in the com2606 build.

### Compute on other machines

```bash
dsh plugin --profile web add dsh-remote
```

SSH workspaces on cluster hosts: `rw_exec`, file reads and writes, port forwarding.
There is no queue scheduler (Slurm/sbatch) in the ecosystem: `dsh-remote` gives
execution, `corewatch-mcp` only monitors machines. `dsh-scnet` does not fit — it is
about the Chinese SCNet.

## ✕ Do not install

| Package | Why |
| --- | --- |
| `@bushizhanghan/dsh-openfoam-doctor` | WSL-only: `spawn('wsl.exe')`, `isWslPath` rejects `/home/...`; on Linux its tools do not register |
| `dsh-session-search` 0.1.1 | `engines.dsh` up to `0.2.1-rc.1` — installing it on 0.2.2-rc.5 breaks the profile |
| `@kikulmj/dsh-jupyter` | Registers a tool named `python` — a clash with any python plugin |
| `@copylee/dsh-office` | The `office_render`/`office_read` tools collide with the built-in `office` skill; requires Windows and MS Office |
| `dsh-pptx-sidebar`, `dsh-docx-sidebar` | `engines.dsh <0.2.1` |
| `dsh-office-kit`, `dsh-pptx-studio` | Verified on Windows only (PowerShell rendering), pull in a dozen pip packages |
| `dsh-typst`, `dsh-typst-plugin` | No `typst` binary: the first hands back an uncompiled `.typ`, the second brings 34 peer dependencies for a UI |
| `dsh-pdf-mineru` | Cloud MinerU or a self-hosted service, not offline |
| `dsh-pdf-formula` | `pdf_info` collides with `dsh-pdf-tools` — the second plugin dies on the duplicate |
| `dsh-latex-studio`, `dsh-latex-tools`, `@salism3/dsh-latex-editor` | A third compiler in the same directory (shared `.aux`), writes `.bib` in place; tools and editor have no model-facing tools |
| `dsh-zotero`, `@hanxu131/dsh-zotero` | The first: 17 dependencies, 30 MB and reads `zotero.sqlite` while Zotero is running (locks); the second requires `dsh >=0.2.3-alpha.2` |
| `@ggboy123/dsh-paper-reader`, `@eduwork/dsh-literature`, `@shlv/dsh-literature`, `@zhe_xuan/dsh-paper-desk` | Superseded (`-evidence` instead of reader), share the `literature_*` names, pull 11 `@deepseek-ai` peers or introduce a second library next to Zotero |
| `dsh-carsi-papers`, `dsh-scihub` | Legal and ethical flags: access to paywalled databases and Sci-Hub |
| `dsh-ustc-latex-agent` | GPL-3.0 and an external co-editing service |

## Missing from the ecosystem (do not search again)

- Figure quality checks: fonts, DPI, colorblind palette, "redraw figure 3".
- matplotlib/plotly/vega wrappers with scientific palettes: `dsh-chart` draws its own SVG for draft figures, `dsh-chart-ascii` — into the terminal.
- Markdown/HTML → PDF: only Office→PDF (alpha) and Typst→PDF (needs the binary).
- Local OCR: `tesseract.js` shows up only inside a CLI, not as a plugin.
- Writing annotations into the PDF file: every plugin keeps them in its own database or in Zotero.
- A single `.bib` manager with locking and Zotero sync.
- Slurm/job queue, gmsh, ParaView, Cantera, COMSOL, HDF5 as plugins.
- Fluent and CFD as a category: zero packages in the registry.
- A "Zotero MCP" bridge as a DSH plugin: port 23120 is served by the Zotero add-on, and the `zotero-mcp*` npm packages are plain MCP servers.

## Already covered by what is installed

| Category | Covered by |
| --- | --- |
| Publication-quality figures | `latex_look` + TeX Live + matplotlib on the host; no plugin needed |
| Tables from office files | `table_ingest`, `data_profile/clean/verify/report` |
| HTML slides | `revealjs_generate` |
| docx/xlsx/pptx | the built-in `office-*` skills + LibreOffice |
| Literature | `dsh-zotero-local` (or the Zotero panel), `kb_rag`, `.bib` export |
| Checking the layout by eye | `latex_look` + `modlens_read_image` |

## Install order

1. `dsh plugin --profile web add dsh-zotero-local dsh-cite dsh-kb-rag`
2. `dsh plugin --profile web add dsh-pdf-tools dsh-pdf-table dsh-data-quality dsh-table-ingest`
3. `dsh plugin --profile web add @fffangchenghao/dsh-latex-look` (if not there yet)
4. per task: `dsh-remote`, `fluent-case-builder`, `dsh-openfoam-workbench` + `mesh-toolkit`
5. optionally: statistics, documents, infrastructure

After installing, restart DSH: the tool catalog is fixed for the session, otherwise the
new tools will not appear in an open chat.

## Task → tool map

This is not decoration: the same rows sit in the prompt (`research-stack`, order 56),
so the agent picks a tool by task rather than by whatever came to hand first.

| Task | Solved by |
| --- | --- |
| PDF: pages, a section, a quotation, a table | `pdf_info` → `pdf_outline`/`pdf_search` → `pdf_text`; tables `pdf_tables`/`pdf_to_csv`; `pdf_render` only for pages without text |
| Zotero: what is there, what a paper is about, annotations | `zotero_search` → `zotero_digest`/`zotero_retrieve`/`zotero_fulltext`, `zotero_annotations`, `zotero_export` |
| References and `.bib` | `cite_lookup`, `cite_format`, `cite_bibtex`, `cite_check`, `cite_batch` |
| Tables and data | `data_profile`, `data_verify`, `data_clean`; `table_ingest` for xlsx/docx/csv |
| Statistics and reproducibility | `stat_check`, `stat_recompute`; `repro_manifest` → `repro_check` → `repro_card` |
| Any number in an answer or a paper | a script in `analysis/scripts/`, an artifact in `analysis/figures` or `runs/<id>/results` |
| How a page of the paper looks | `latex_look` (build + render + SyncTeX + diff) |
| A presentation | `pptx_create` → `pptx_add_slide(template)` → `pptx_add_chart`/`pptx_add_math` |
| `.docx` for proofreading | `doc_inspect` → `doc_replace_text`/`redline_diff`/`doc_change_summary` |
| CFD: case, mesh, run, fields | `openfoam_*`, `fluent_case_*`, `mesh_build`/`mesh_check`/`stl_*` |
| Journal and provenance | `notebook`, `notebook_search`, `notebook_verify`, `provenance_of_file`, `provenance_verify` |

If the session does not have the right tool, that is no reason to write a bash parser:
say what is missing and install the bundle from the table above.
