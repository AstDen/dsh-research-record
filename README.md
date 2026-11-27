# dsh-research-record

A DeepSeek Harness bundle for people who do research and have to trust their own
numbers a month later.

Every chat ends. The session log ends with it. What survives is what you wrote
down: a hypothesis before the run, a method with its parameters, an observation
with units and the path to the log, a decision with its reason — and a record of
which file came from which step, so a figure can be traced back to the data that
produced it.

This bundle gives a DSH profile that record, a guard around the raw data, tools
for the figures a journal will accept, a survey for a directory that already has
years of work in it, and a usage report you can send to whoever maintains it.

Nothing here talks to a server. The state lives in the project, in ordinary
files: `.dsh/notebook/`, `.dsh/provenance/`, `.dsh/map/`, `.dsh/usage/`.

## Install

```bash
dsh plugin --profile web add dsh-research-record
dsh --profile web --dump-config | grep research-record   # eight rows must appear
```

Restart the profile afterwards: the tool catalogue is fixed per session.

Requires DSH `>=0.2.0 <0.3.0`. No runtime dependencies.

## What you get

### The record

| Tool | What it does |
| --- | --- |
| `notebook` | append a `hypothesis`, `method`, `observation`, `decision` or `note`; immutable records, corrections through `supersedes` |
| `notebook_search` | search every journal in the project, read one record, refuse a stale digest |
| `notebook_verify` | recompute the whole hash chain and name the first broken line |
| `provenance_of_file` | walk the graph upwards: which step produced this file, from which inputs, `observed` or `inferred` |
| `provenance_verify` | check the integrity of the provenance journal and re-hash recorded outputs |

The notebook is hash-chained: `hash = sha256(canonical JSON without hash)`,
`prevHash` is the previous line's hash, genesis is 64 zeros. Editing a record by
hand breaks the chain and `notebook_verify` says where.

Provenance is **observed**, not declared: it is written by a `tools/result`
listener, and there is no tool for writing to it. A figure cannot claim inputs it
did not read.

### The guard

`.dsh/policy.json` protects input paths (`data/raw/**`, `data/**` by default,
editable per project). Writes there are denied for `write`, `edit` and mutating
`bash`; `rm -rf`, `git reset --hard`, `find -delete`, `dd`, `shred` ask for
confirmation. Every denial is appended to `.dsh/guard/blocked.jsonl`, and
`policy_status` shows what was blocked and why.

The bash classifier scans tokens, not a shell grammar, so a command whose *text*
mentions a protected path can be denied too. That is deliberate: a false denial
costs one retried command, a false allow silently rewrites raw data.

### Starting a project

```
/research-init Пористая труба: режим течения и Δp
```

Creates the skeleton for a research directory — `PROJECT.md` with the question
and a numeric success criterion, `hypotheses/registry.md`, `literature/`,
`models/`, `runs/`, `data/`, `analysis/`, `paper/`, `talks/`, `admin/` — plus
`AGENTS.md` with the journal discipline and two rules that outrank it:

> **Do not invent — verify.** A path is cited only after `ls`, `test -f` or
> reading it; a number only with the file, script or log it came from.
>
> **The script computes.** Every conversion, mean, difference, integral or fit
> runs as a script in `analysis/scripts/`; arithmetic in the answer is a defect.

The directory becomes self-describing: the marker `.dsh/research-project.json`
makes the bundle add a short identity section to every later session in it.

### Adopting a project that already exists

Half of a real research folder is a study with negative results, part is an
experiment nobody wrote up, part is the thing in progress. Two tools join such a
directory without reorganising it:

```
project_survey   # walk, classify, extract what a file proves; writes nothing
project_adopt    # three plans, one at a time, nothing moved by the plugin
```

- **`as-is`** — only `.dsh/` and an `AGENTS.md` pointer; not one folder added.
- **`light`** — adds missing standard folders, moves nothing.
- **`restructure`** — lists candidate moves; the model performs them one by one,
  with a `decision` record and a `notebook_verify` after each.

The archival journal separates facts (with the path that proves them), guesses
(marked, with what would confirm them) and the plan.

Kinds and roles are two layers. **Kinds are data**: a pack (`packs/*.json`, or
`<project>/.dsh/packs/*.json` to override) maps extensions, names, field patterns
and directory signatures to kinds. Four ship: `numeric-openfoam`, `experiment`,
`custom-code`, `literature`. **Roles are universal** — `run`, `raw-data`,
`derived`, `analysis`, `paper`, `literature`, `talks`, `admin`, `archive`,
`empty`, `mixed` — decided by what is *inside* a directory, not by its name.

Measured on 21 CFD projects: 44.3 % of files unclassified before the packs,
**5.2 %** after, 5 s wall time, nothing written into the projects. What is still
unrecognised is reported (`unknownNames`, top-20 with counts) instead of guessed:
that list is how `.cgns` and 67 511 extension-less OpenFOAM fields were found.

### Figures a journal accepts

`figurelib/` is a small matplotlib library with a contract:

| Panels in a row | Sheet | Legend |
| --- | --- | --- |
| 1 | 90 × 50 mm | inside, no panel letter |
| 2 | 190 × 50 mm, fixed | inside, corner chosen by `auto_legend` |
| 3 | 190 mm × (50 + measured footer) | below, measured, never on the x-label |

Plus `setup_axes` (grey 0.25 pt ticks, inward), `set_axis_range` with a rounded
step from `nice_step`, panel letters (`а, б, в` for Russian, `a, b, c` for
English), `bilingual_loop` writing `figure_ru.pdf` and `figure_en.pdf` as two
separate files, and `save_data_table` putting the plotted numbers in a text file
next to the figure.

`figure_spec` plans a figure before it is drawn; `figure_check` reads the PDF back
(page size from the MediaBox, embedded fonts from `/BaseFont`, Type 3 warning) so
"it looked fine" is not the acceptance criterion.

### Usage report

```
usage_report action=summary     # or /usage-report 30
usage_report action=export      # writes report-<stamp>.md and .json
```

Records forms, never content: tool name, ok/error, duration, a hashed session id,
role, model, argument *names*, byte size, file extensions, a sanitized error
message. No argument values, no file contents, no prompts, no journal records.

Four blocks: who carries the work, who fails (with the frequent error text), how
far the journal funnel gets (hypotheses → observations → artifacts), and what is
suggested to change — every suggestion names the number that justified it. The
exported file is meant to be safe to send to a maintainer.

### Recommended stack

`/research-stack` prints the plugins this bundle builds on and around —
literature (`dsh-zotero-local`, `dsh-cite`), LaTeX (`dsh-latex-look`), PDF
(`dsh-pdf-tools`, `dsh-pdf-table`), tables (`dsh-data-quality`, `dsh-table-ingest`),
documents (`dsh-pptx-builder`, `dsh-docx-redline`), statistics
(`@perrylink/dsh-research-core`, `dsh-statcheck`), CFD (`fluent-case-builder`,
`dsh-openfoam-workbench`, `mesh-toolkit`), remote machines (`dsh-remote`) — with
the levels `core` / `optional` / `situational`, a map "task → tool", and a list of
packages **not** to install with the reason. `research_stack action=install`
prints the exact command; it installs only with `confirm: true`.

## Skills

| Skill | When it loads |
| --- | --- |
| `research-record` | before computing, measuring or concluding anything that must be reproducible tomorrow |
| `matplotlib-figures` | when a figure is meant for a paper: geometry, bilingual files, verification |
| `project-adoption` | when joining an existing directory: survey, journal, three plans, one step at a time |

## Honest limits

- The journal is per session; a project timeline is the union of session files.
  `notebook_search scope=project` reads them all, but nothing merges them into one
  narrative yet.
- The guard is a token scan, not a shell parser (see above).
- `restructure` never moves anything itself, by design.
- Adoption is bounded: when the walk hits `max_files`, the map says so and the
  plan calls itself preliminary.
- The figure library encodes one journal's geometry contract. It is a good
  contract, not a universal one; `figure_check` reports what it measured, so a
  different contract fails loudly instead of silently.

## Relation to `@perrylink/dsh-research-core` (REP v1)

REP is a protocol: claims, sources, snapshots, checks, with a shared service
`ctx.researchEvidence` that eighteen plugins mount. This bundle is an
application: it records the work and the files. They overlap on one idea —
content-addressed, verifiable records — and they answer different questions. REP
answers "is this sentence in the manuscript supported by a source"; this bundle
answers "where did this number come from and what did we try". A bridge that
publishes notebook observations as REP evidence is possible without depending on
it; nothing here requires it.

## License

MIT. See `LICENSE`.
