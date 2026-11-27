# dsh-research-record

A DSH bundle that makes a research session auditable: a **hash-chained lab
notebook**, a **file provenance graph**, a **guard** for protected input paths,
and a **project scaffold** that turns a directory into a research project. Everything lives in ordinary files under `<workspace>/.dsh/`, so a
journal survives context compaction, is readable by a human, lives in git, and
can be verified by anyone with `sha256`.

Version: `0.2.0` · Engines: `dsh >=0.2.0 <0.3.0` · Platform: `web` (host tools
work on every platform; the two panels need the web UI).

## Install

```bash
dsh plugin --profile web add /home/claster/Documents/deepseek-harness/default-workspace/dsh-research-record
dsh --profile web --dump-config | grep research-record   # eight rows must appear
# restart DSH, then in a new session:
#   notebook, notebook_search, notebook_verify, provenance_of_file,
#   provenance_verify, policy_status, research_init, research_stack,
#   figure_spec, figure_check, usage_report, project_survey, project_adopt
#   and the commands /research-init, /research-stack, /usage-report
```

`dsh plugin add` links the directory into the profile and appends the bundle to
`dsh.profile.bundles`; the bundle's own `cordis.patch.yml` inserts the plugins.

Uninstall: `dsh plugin --profile web remove dsh-research-record`. Nothing under
`.dsh/` is deleted — the journal is data, not installation state.

## Composition

| File | Role |
| --- | --- |
| `cordis.patch.yml` | inserts `research-record-notebook`, `-provenance`, `-scaffold`, `-guard` |
| `index.js` | package entry; mounts the same four (do not install both) |
| `notebook.js` | journal, hash chain, three tools, prompt digest |
| `provenance.js` | step journal, lineage walk, two tools, `/provenance` route |
| `guard.js` | `tools/pre-execute` gate, `policy_status` |
| `scaffold.js` | `research_init` tool, `/research-init` command, project identity in the prompt |
| `client.js` | web UI: Notebook panel + Provenance action |
| `smoke.mjs` | acceptance checks with a fake host (`node smoke.mjs`) |
| `smoke-fixes.mjs` | acceptance for digest scoping, attribution, auto notes |
| `smoke-scaffold.mjs` | acceptance for the project scaffold |
| `stack.js` | `research_stack` tool (show / install), `/research-stack` command, routing table in the prompt |
| `smoke-stack.mjs` | acceptance for the stack data, the routing table and the install tool |
| `figures.js` | `figure_spec` (sheet geometry) and `figure_check` (PDF verifier) |
| `figurelib/` | Python drawing library: `style.py`, `bilingual.py`, `table.py`, `check.py` |
| `smoke-figures.mjs` | acceptance for the geometry, the JS/Python agreement and a real PDF |
| `telemetry.js` | usage events, the effectiveness report, `usage_report` + `/usage-report` |
| `survey.js` | bounded walk of an existing tree, the map, the archival journal, three adoption plans |
| `smoke-usage.mjs` | acceptance for the report, and for its privacy (no values, no paths) |
| `survey.js` | walking an existing tree, the map, the archival journal, the three adoption plans |
| `smoke-adopt.mjs` | acceptance for the walk, the facts, the plans and the promise that nothing moves |
| `docs/IMPROVING.md` | how to add a tool, a skill, a route; the invariants; the change loop |
| `docs/CHANGELOG.md` | one line per release |

## Research project scaffold

A directory of loose files is not a research project: nothing tells the model
that raw data is frozen, that a run needs a protocol, or that a hypothesis has to
be written before the calculation. The scaffold makes that explicit once, and the
prompt carries it afterwards.

```text
/research-init Пористое горение        # or: the model calls research_init
```

Both entry points run the same `scaffoldResearchProject(workspace, options)`:

| Created | Why |
| --- | --- |
| `AGENTS.md` | the rules the harness feeds back as workspace instructions in every later session: journal discipline, frozen raw data, no fabrication, scripted computation |
| `README.md` | the folder map and the order of work, for the human |
| `PROJECT.md` | the brief form: question, boundaries, hypotheses, data, model, success criterion |
| `hypotheses/registry.md` | hypothesis register with IDs and statuses |
| `literature/README.md` + `notes/` + `refs/` | one card per source |
| `models/README.md` | what every setup must pin (solver version, grid, BCs) |
| `runs/README.md` | the run protocol: `run.md`, config, log, results, `conclusion.md` |
| `analysis/README.md` + `scripts/` + `figures/` + `tables/` | a figure is the output of a script |
| `paper/README.md` + `sections/` + `figures/`, `talks/`, `admin/` | writing and reporting |
| `data/raw/` (read-only) + `data/derived/` | the guard protects the former |
| `.dsh/policy.json` | `protectedPaths: ['data/raw/**', 'data/**']` |
| `.dsh/research-project.json` | the marker: `kind: research-project`, name, phase, folder map |

Two rules in `AGENTS.md` carry the project's scientific honesty, and the identity
section repeats them so they survive a session that never opens the file:

- **verify, do not invent** — a path is cited only after `ls`/`test -f`/reading it,
  a number only with the file, script or log it came from; a missing value is
  reported as missing instead of filled with a plausible one;
- **the script computes** — every conversion, mean, difference, ratio, integral or
  fit runs as a script under `analysis/scripts/`, and the model reads its output;
  arithmetic in the answer or in the manuscript text is a defect, not a style.

The marker is what makes the directory self-describing. When it exists, the
prompt gets a `research-project-identity` section (order 55) naming the project,
pointing at `AGENTS.md` and `PROJECT.md`, and restating the journal discipline —
so a session that starts in that directory knows what it is working on without the
user repeating it. A directory without the marker gets no section.

Idempotence is the contract:

- a file that exists is never rewritten (it is reported in `skipped`), so running
  the scaffold on a live project only fills the gaps;
- the project name given the first time is kept when a later call omits it —
  re-deriving it from the directory name would silently rename the project;
- `createdAt` in the marker survives, `updatedAt` moves;
- `force: true` rewrites the forms and is meant for a project whose templates are
  still untouched.

The command is the fast path (one write pass, no model turn); the tool is the path
the model takes when the user says "this directory is for a research project". Both
leave an `auto` note in the journal citing the created files, so the project's
first record is not empty and the scaffold itself is auditable.

## Figures

`figurelib/` is the drawing library distilled from a working manuscript
workflow, and `skills/matplotlib-figures/` teaches the model to use it. The unit
of success is a PDF whose page is exactly the journal column width and whose
type matches the rest of the paper — not a picture that looks right on screen.

| Panels in a row | Sheet | Legend | Letters |
| --- | --- | --- | --- |
| 1 | 90 × 50 mm | outside, to the right | none |
| 2 | 190 × 50 mm, rigid | inside the panel, corner chosen by `auto_legend` | a, b |
| 3 | 190 × (50 + measured footer) | below the x-labels, band measured | a, b, c |

Two facts force this table. A journal column is 90 mm and the text width is
190 mm, so a figure is drawn at one of those widths and the height follows from
the panel; and `constrained_layout` reserves nothing for a `fig.legend`, so a
footer legend must be measured (`legend_height_mm`) and the axes shrunk by hand
(`make_footer_figure` + `footer_legend`) or it lands on the x-labels.

Verification is a tool, not an opinion: `figure_check` reads the page box from
the PDF, lists the embedded fonts and compares the family with what the style
asked for (`LinLibertineO` in the PDF for the `Linux Libertine O` family), and
warns when the sheet is not 90/190 mm, when the font fell back, or when the PDF
carries Type 3 fonts. `figure_spec` answers the geometry question before the
script is written, and refuses a 100 mm sheet or a fourth panel.

The bilingual rule is part of the library, not a convention to remember: every
figure is produced twice (`_ru.pdf`, `_en.pdf`) with translated axis labels,
legend strings and panel letters (`абв…` / `ab…`) by one `bilingual_loop` call,
because renaming one file is how a Russian paper ends up with an English figure.

`figurelib/table.py` writes the numbers behind the figure next to it — the same
`save_data_table` contract as the workflow it came from, so a figure that is
questioned can be checked against its table without re-running the model.

## Recommended stack

`research-record` covers the record; literature, typesetting, tables and
calculation come from other bundles. `stack.js` holds the curated list as data —
`STACK` (level `core`/`optional`/`situational`), `AVOID` (known traps with the
reason), `GAPS` (what does not exist, so nobody searches twice) — and renders it
through the `/research-stack` command. `docs/RECOMMENDED.md` is the same content
for a human reader, with install order and the "already covered" table.

Two rules for the data, both enforced by `smoke-stack.mjs`: every entry names a
level and a reason, and every entry with packages carries an install command that
mentions each of those packages. A recommendation that cannot be pasted is
decoration.

Two ways in, and neither installs behind the user's back:

- `/research-stack [core|optional|situational|routes|all]` prints the levels, or
  just the routing table;
- the `research_stack` tool takes `action: "show"` (same content) or
  `action: "install"` with a `level`. **Without `confirm: true` it prints the
  command and changes nothing**; with it, it runs `dsh plugin --profile <p> add`
  and returns the output. Installing from inside the session usually needs the
  profile to be writable, which is why the tool recognises `EROFS`/`EACCES` and
  tells the reader to run the command in a terminal or switch
  `/permission danger-full-access` instead of failing silently.

`verified` records the registry check date, because a pinned version that nobody
re-checked is a lie waiting to happen.

### Routing: which tool answers which question

A recommendation nobody remembers is decoration, so the same module carries
`ROUTING` — a table of task families and the tools that answer them:

| Task | Tools |
| --- | --- |
| PDF: pages, a section, a quote, tables | `pdf_info` → `pdf_outline`/`pdf_search` → `pdf_text`, `pdf_tables`/`pdf_to_csv`, `pdf_render` only for pages without a text layer |
| Zotero: what is in the library, annotations | `zotero_search` → `zotero_digest`/`zotero_retrieve`/`zotero_fulltext`, `zotero_annotations`, `zotero_export` |
| references and `.bib` | `cite_lookup`, `cite_format`, `cite_bibtex`, `cite_check`, `cite_batch` |
| tables and data | `data_profile`, `data_verify`, `data_clean`; `table_ingest` for xlsx/docx/csv |
| statistics and reproducibility | `stat_check`, `stat_recompute`; `repro_manifest` → `repro_check` → `repro_card` |
| any number in an answer or a paper | a script under `analysis/scripts/`, artifacts in `analysis/figures` or `runs/<id>/results` |
| the paper's page | `latex_look` (compile + render + SyncTeX + diff) |
| a talk | `pptx_create` → `pptx_add_slide(template)` → `pptx_add_chart`/`pptx_add_math` |
| a `.docx` under review | `doc_inspect` → `doc_replace_text`/`redline_diff`/`doc_change_summary` |
| CFD: case, mesh, run, fields | `openfoam_*`, `fluent_case_*`, `mesh_build`/`mesh_check`/`stl_*` |
| journal and provenance | `notebook`, `notebook_search`, `notebook_verify`, `provenance_of_file`, `provenance_verify` |

The table is injected as the prompt section `research-stack` (order 56) with one
sentence of enforcement: if the task falls in a row, use that tool — not a bash
one-liner or a hand-written parser — and if the tool is missing from the session,
say so and offer the install instead of improvising around it.

## Usage report

`telemetry.js` records one event per tool call into
`<workspace>/.dsh/usage/events.jsonl` and turns those events into a report.
The reason is not surveillance: a bundle that is improved on the basis of "it
feels better" drifts, and a colleague's project is the only honest test.

What is written: tool name, success, duration, a short session hash, role
(`lead`/`subagent`), model, agent preset, argument **names**, argument size, path
extensions, and — on failure — the first line of the error with paths replaced by
`<workspace>` and `~`. What is never written: argument values, file contents,
prompts, journal bodies.

```text
usage_report action="summary" days=30     # print the report
usage_report action="export"              # write .dsh/usage/report-<stamp>.md + .json
/usage-report [дней|export]               # the same from the chat
```

The report has four blocks: the tool table (calls, errors, p50, last use), the
journal funnel (`hypothesis → method → observation → decision`, automatic notes,
outcomes), the suggestions, and a line stating what the report does not contain.
A suggestion always names its evidence — error rate and the most frequent error,
zero `notebook` calls against N tool calls, `figure_spec` without `figure_check`,
a route that never fired — because a suggestion that cannot be checked is a guess
with a confident tone.

Both exported files carry the project *basename* only. That is what makes them
attachable to an issue: `docs/IMPROVING.md` describes how a maintainer reads two
projects side by side.

## Storage

```
<workspace>/.dsh/
  policy.json                     # guard policy, hand-written
  guard/blocked.jsonl             # every deny/ask, one JSON line
  notebook/<sessionId>.jsonl      # one record per line, hash-chained
  notebook/supersede.jsonl        # correction ledger: targetId -> byId
  provenance/<sessionId>/steps.jsonl
```

### Notebook record

`hash = sha256(canonicalJson(record without hash))`, keys sorted, no whitespace;
`prevHash` is the previous line's `hash`, genesis is 64 zeros. Records are never
edited — a correction is a new record with `supersedes`, and the link is
appended to `supersede.jsonl` (readers project `supersededBy`; rewriting the old
line would break the chain and defeat the point).

Server-side gates, so a model cannot talk its way past them:

- `hypothesis` requires `title`;
- `outcome` is accepted only for `observation`/`hypothesis`, dropped otherwise;
- `execution.state=completed` without `execution.evidence` becomes `unverified`
  and the response carries `warnings[]`;
- every `artifacts[].path` is hashed at write time and re-hashed on read:
  `unchanged` / `changed` / `missing`;
- `evidence[].entryId`, `supersedes`, `relatesTo` that name a record in no
  journal of this workspace are dropped with a warning.

`notebook_search action=read expectedDigest=<hash>` refuses when the stored
record no longer matches the digest the caller last saw — that is how a tampered
journal is caught in normal work, without running a full verify.

### Provenance step

Observed from `tools/result`, never by rewriting arguments:

- `write` → the file becomes an output with its sha256 (`observed`);
- `edit` → output plus the pre-image hash when the snapshot knew it, so versions
  are distinguishable;
- `bash` → the workspace is scanned before/after; files whose `mtime`+`size`
  moved become outputs, hashed only if they changed (`observed`). A scan that
  cannot finish degrades the step to `inferred` instead of guessing;
- any other tool → path-shaped arguments become `inputs`.

Limits: ≤200 edges per step; files >512 MB are recorded `"unhashed"`; a
workspace above 20 000 files degrades to mtime-only detection (`"degraded"` in
`notes`). `node_modules`, `.git`, `.dsh`, `dist`, `build`, `target`, `.venv`
and `__pycache__` are outside the scan.

`provenance_of_file` walks upward: ≤12 hops, ≤60 nodes, one version per path,
self-referencing input edges collapse into `previousSha256`.

`provenance_verify` is metadata-only by default (JSON validity, unique ids,
monotone timestamps) so 100+ steps verify in well under 200 ms; `checkFiles`
re-hashes every latest recorded output and skips paths that a later step
legitimately rewrote.

### Actor attribution

A step names the actor that ran it, not the harness that hosted it:

```json
{"toolName":"write","role":"subagent","model":"deepseek-account/deepseek-flash",
 "parentSession":"01JC…","delegationDepth":1}
```

`role` comes from the session header (`origin: 'subagent'` or `delegationDepth > 0`
→ `subagent`, otherwise `lead`). The model comes from the `agent/pre-step`
payload: tool execution carries no model selection, so it is cached per agent at
step admission and read back when the step is written. Without that, every
delegated step of a subagent looked like the lead's own work.

A step whose actor cannot be resolved still records (`role: "lead"`, `model` from
row config) — attribution is best-effort, the step is not.

### Automatic artifact notes

When a step produces files, the journal gets one machine-written `note`
(`auto: true`, `tags: ["auto"]`, `stepId`) citing the produced paths and their
sha256. The model never writes it: the point is that an artifact cannot enter the
project without the journal knowing.

- Deduplicated: a path already cited by any record of the project is skipped, so
  a file the model described by hand is never shadowed by a stub.
- One note per step, not per file.
- Disabled by `autoNotes: false` in row config; never written for failed steps.
- The note is a prompt to explain, not an explanation: its body says so.

`notebook_verify` covers these notes like any other record — the chain includes
them.

### Guard

Policy, workspace-relative globs; `dir/**` covers the directory itself and its
subtree:

```json
{ "protectedPaths": ["user_data/**", "data/**"], "destructiveConfirm": true }
```

- `write`/`edit` to a protected path → `deny` with advice to work in a copy under
  `derived/`;
- `bash` that mutates a protected path (redirect targets and path-shaped tokens
  of mutating commands) → `deny`;
- `rm -rf` (either flag order), `git clean -f`, `git reset --hard`,
  `find … -delete`, `dd `, `shred ` → `ask` when `destructiveConfirm` is true.

Row config overrides the file, so a profile can pin a policy:

```yaml
- id: research-record-guard
  config: { protectedPaths: ["data/**"], destructiveConfirm: true }
```

## Configuration

No `Config` schema is declared on purpose: the bundle has zero runtime
dependencies and must load in profiles that do not ship `@deepseek-ai/schemastery`
next to it. `apply(ctx, config)` reads the documented keys defensively:
`protectedPaths`, `destructiveConfirm`, `autoNotes` (set `false` to stop the
automatic artifact notes), and for telemetry `enabled`, `recordAllTools` (set
`false` to record only the record/figure tools) and `maxFileBytes` (rotation at
5 MB by default). Everything else lives in `policy.json`.

## Decisions worth knowing

1. **Four patch rows, not one.** `--dump-config` must show all four plugins,
   so each is inserted separately. `index.js` mounts them for direct imports and
   must not be inserted alongside them (duplicate tool names fail registration).
2. **Supersede ledger instead of mutation.** Append-only storage cannot carry
   `supersededBy` inside the old line without breaking `hash`/`prevHash`.
3. **Project scope for evidence.** An `entryId` is valid if any journal in the
   workspace has it — the brief's "another project" means another workspace.
4. **Guard checks `bash` heuristically.** Token scanning is not a shell parser;
   it errs on the side of denying the obvious writes (`> file`, `cp`, `rm`,
   `sed -i`) and no more. A miss is a policy gap, not a silent allow of
   everything.
5. **The digest follows the session, not the process.** A prompt section that
   reads `process.cwd()` shows the harness's own journal to every project; the
   section resolves the agent from its assembly context and reads that session's
   project directory. An unknown scope renders nothing — a missing digest costs
   prompt space, a foreign one corrupts the reasoning.
6. **The scaffold writes a marker, not a system prompt.** The project rules live
   in the project's own `AGENTS.md` plus a small marker-driven prompt section, so
   they travel with the directory (git, archive, another machine) instead of with
   the plugin installation.
7. **Automatic notes are stubs on purpose.** They carry paths and hashes, never
   an interpretation: a machine guessing what a figure means is worse than a
   blank line the model is asked to fill.
9. **Telemetry records shapes, not content.** A report that can be sent to a
   maintainer must not carry the researcher's paths, arguments or journal text:
   the fields are names, sizes, extensions, durations and error shapes, and
   `smoke-usage.mjs` asserts that a recorded call does not contain its own
   argument values. The report is a file the user exports on purpose, not a
   dashboard that watches them.

8. **The guard errs towards refusing.** The bash classifier scans tokens, not a
   shell grammar, so a command whose *text* mentions a protected path (a heredoc
   that writes a `data/raw` example) is denied too. A false denial costs one
   retried command; a false allow silently rewrites raw data, so the heuristic is
   not loosened — the write goes through `write`/`edit`, or the file is moved out
   of the protected tree on purpose.

## Project adoption

A directory that already contains years of work is the normal case, not the
exception: half of it is a study with negative results, part is an experiment
nobody wrote up, part is the thing in progress. `survey.js` exists so that the
bundle can join such a project without reorganising it by force.

Two tools, both additive:

| Tool | What it does | What it writes |
| --- | --- | --- |
| `project_survey` | walks the tree within `max_files`/`max_depth`, classifies every file by kind, extracts the facts a file proves (CSV header → columns, `\title{}`, notebook cell count), reports run-like / paper-like / literature-like / empty directories | nothing unless `apply: true`, then `.dsh/map/map.md` + `tree.json` |
| `project_adopt` | builds all three plans and, with `apply: true`, writes the chosen one | `.dsh/map/archival-journal.md`, `.dsh/policy.json` (if absent), `AGENTS.md` (if absent), and for `light`/`restructure` the standard directories plus `literature/_INDEX.md` |

The three modes are ordered by how much of the owner's structure survives:

- **`as-is`** — only `.dsh/` and an `AGENTS.md` pointer; not one folder is added.
  The strongest fit; for a project under review or a tree the owner is proud of.
- **`light`** — adds missing standard folders and an index of what already exists;
  moves nothing. The usual choice.
- **`restructure`** — lists candidate moves (PDF → `literature/refs/`, tables and
  logs → `runs/<id>/results/`, images → `analysis/figures/`, `.tex` → `paper/`,
  meshes → `models/`). The tool never performs them: the model does, one directory
  at a time, with a `decision` record and a `notebook_verify` after each, because
  only the owner can tell a dead run from the run behind a published figure.

The archival journal separates three kinds of statement on purpose — facts (with
the path that proves them), guesses (marked, with what would confirm them) and the
plan. That separation is the whole value: a month later nobody remembers which
sentence was checked.

The skill `skills/project-adoption/SKILL.md` carries the order of operations and
the rules that outrank any plan: read before touching, a directory name is not
evidence, guesses are marked, nothing is deleted, raw data is read-only, and every
move gets a `decision` record plus a `notebook_verify`.

Two decisions worth keeping:

10. **The map is written next to the project, not into the profile.** State belongs
    to the project: `.dsh/map/` travels with the directory, a colleague who copies
    it gets the map, and deleting the profile loses nothing.
11. **Markers are opt-in.** `markers: true` writes a small `.dsh-map.json` into
    every visited directory so the graph survives a `cd`, but it is a visible
    change inside the owner's folders — the skill tells the model to ask first.

Limits are reported, never hidden: when the walk hits `max_files`, the map says
so and the plan calls itself preliminary.

## Universal layer: packs and roles

The first benchmark of `project_adopt` ran on 21 CFD projects and left 44 % of
all files classified as `other`: OpenFOAM time directories full of fields called
`p`, `T`, `CH3OH`. A classifier that only knows one person's library is not a
classifier, so kinds and roles are separated into two layers.

**Kinds are open data, not code.** A pack is a JSON file (`packs/*.json`, or
`<project>/.dsh/packs/*.json` to override for one project) that maps extensions,
exact names, a field-name pattern and directory signatures to kinds and roles.
Four packs ship: `numeric-openfoam`, `experiment`, `custom-code`, `literature`.
Adding a domain, or teaching the tool a colleague's naming, is a data edit — not
a release, and not a risk to the other packs.

**Roles are universal.** Every directory gets one of `run`, `raw-data`,
`derived`, `analysis`, `paper`, `literature`, `talks`, `admin`, `archive`,
`empty`, `mixed` — decided by what is *inside* it, not by what it is called:
a run directory has parameters and a result, or a log, or a case with fields.
Names only raise a candidate's score; they never decide alone. A directory
without files inherits the role of its children, which is why a `runs/` holding
a single `case_a/` is a run directory rather than an empty one.

**Detection is additive and says so.** `detectPacks` reports each pack with its
share and the evidence that produced it (`CH4 ×516`, `.foam ×9`). Below 5 % the
tool says "domain not determined" instead of guessing, and the plan degrades to
the universal skeleton.

**The skeleton follows the roles.** `skeletonForRoles` creates `literature/refs`
and `literature/notes` for a literature-only project, `runs/` and the raw-data
folders for a numeric one, and never invents `runs/` where nothing is ever run.
Each created path carries the reason that justified it, and the plan prints it.

**What nothing recognised is a feature.** `unknownNames` lists the top-20 names
the classifier could not place, with counts. That list is how `.cgns` (4 048
files) and the 67 511 extension-less OpenFOAM fields were found; it is also the
first thing to read when a new domain arrives, because it names the pack that
does not exist yet.

Two decisions:

12. **Text sniffing is not a finding.** An unknown file that reads as text stays
    `other`: counting it as `text` would silently erase the very names the owner
    needs to see.
13. **A field pattern is bounded by its directory.** `^[A-Za-z][A-Za-z0-9_()+-]{0,20}$`
    is applied only inside a directory the pack recognised as a field directory
    (time step, region). A file called `notes` in `src/` stays unknown.

Measured on the same 21 projects: unclassified 44.3 % → **5.2 %**, wall time 5 s,
nothing written into the projects.

## Limitations

- The journal is per session; a project timeline is the union of session files
  (`notebook_search scope=project`). The prompt digest is scoped to the session's
  own project: a session whose header carries no `cwd` (or a host that omits the
  scope during assembly) shows no digest rather than another project's.
- Two writers per store (`notebook` and the automatic notes) append under a
  directory lock; a lock older than 10 s is treated as stale. A crash between the
  lock and the append leaves no partial line, but a lock can survive — it is
  removed by the next writer.
- The provenance scan watches the workspace root; writes outside it appear only
  when the arguments name them.
- `/research-init` registers only when the profile mounts the `commands` service;
  the `research_init` tool works regardless, so the model can always scaffold.
- The scaffold creates structure, not content: `PROJECT.md` and the hypothesis
  register stay empty until someone fills them, and the prompt says so.
