# dsh-research-record

[![test](https://github.com/AstDen/dsh-research-record/actions/workflows/test.yml/badge.svg)](https://github.com/AstDen/dsh-research-record/actions/workflows/test.yml)

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

Whether that is enough for someone other than you to pick it up is written down
in [`docs/READINESS.md`](docs/READINESS.md) — including what is still missing.

## Install

Not published to npm yet, so install it from the repository — either a local
clone:

```bash
git clone https://github.com/AstDen/dsh-research-record.git
dsh plugin --profile web add /absolute/path/to/dsh-research-record
dsh --profile web --dump-config | grep research-record   # eight rows must appear
```

or let pnpm fetch it directly:

```bash
dsh plugin --profile web add git+https://github.com/AstDen/dsh-research-record.git
```

`dsh plugin` forwards its arguments to pnpm, so a path, a git URL and a tarball
all work.

Restart the profile afterwards: the tool catalogue is fixed per session.

Requirements: DSH `>=0.2.0 <0.3.0` and Node `>=22`. Nothing else has runtime
dependencies. The figure tools additionally need Python 3 with `matplotlib` and
`numpy`; the rest of the bundle is pure Node.

## First five minutes

```text
research_init name=demo brief="does the coating survive 400 °C?"
notebook type=hypothesis title="the coating holds to 400 °C" body="..."
notebook type=observation title="mass loss 2.1 % at 400 °C" body="TGA, 5 K/min" results=[{"T_C":400,"loss_pct":2.1}] execution={"state":"completed","evidence":"runs/0001/tga.csv"}
provenance_of_file path=runs/0001/tga.csv
notebook_verify
```

If those run, the profile is wired: the journal is written under the project's
own `.dsh/notebook/`, not under `~/.dsh`, and the chain verifies.

## What you get

### The record

| Tool | What it does |
| --- | --- |
| `notebook` | append a `hypothesis`, `method`, `observation`, `decision` or `note`; immutable records, corrections through `supersedes`; one input is capped at 512 KiB |
| `notebook_search` | search every journal in the project, read one record, refuse a stale digest |
| `notebook_verify` | recompute the whole hash chain and name the first broken line; `repair: true` trims a torn tail after copying the file to `.bak-<timestamp>` |
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
editable per project) and lists `allowPaths` exemptions — the scaffold ships
`data/derived/**` and `derived/**`, because derived work is what the project is
for. Writes into a protected path are denied for `write`, `edit` and mutating
`bash`; `rm -rf`, `git reset --hard`, `find -delete`, `dd`, `shred` ask for
confirmation. Every denial is appended to `.dsh/guard/blocked.jsonl`, and
`policy_status` shows what was blocked and why, including the exemption list.

The bash classifier reads the verb (`rm`, `mv`, `cp`, `dd`, …) and treats its
non-flag arguments as write targets; an interpreter such as `python3` counts as
a writer only when given `-i`, so reading a raw file is allowed. It is still a
token scan, not a shell grammar: a command whose *text* mentions a protected path
can be refused as a write. That is deliberate — a false denial costs one retried
command, a false allow silently rewrites raw data.

### Starting a project

```
/research-init Porous pipe: flow regime and Δp
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

`figure_spec` plans a figure before it is drawn — one panel defaults to the 90 mm
column, and `figure_spec` says so before anything is drawn. `figure_check` reads
the PDF back: page size from the MediaBox, whether the font program is embedded
(`/FontFile*`) and whether any font is a Type 3 outline (`/Subtype /Type3`), so
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
- The journal is one JSONL file read end to end: every `notebook_search`, append
  and `notebook_verify` parses the whole session file, so cost grows with the
  journal. At 100 000 records `notebook_verify` takes ~1.3 s and ~1 GB of RSS
  (measured in the 0.8.1 audit). An index is the 0.9 work item; until then a
  session that large is a session worth splitting.
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
