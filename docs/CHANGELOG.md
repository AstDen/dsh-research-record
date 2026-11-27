## 0.8.1 — the record lands in the project, or not at all

- **Fixed: the journal could be written into the launcher's tree.** A session
  whose `workingDirectory` service and session header both came back empty fell
  back to `process.cwd()`, which for a `npx` launch is
  `node_modules/.bin` — the journal (and provenance, and usage log) landed there,
  looked written, and would vanish on the next launcher update. Measured live:
  one hypothesis record ended up in
  `~/.npm/_npx/<hash>/node_modules/.bin/.dsh/notebook/`.
- `resolveWorkspace(ctx, exec, config)` replaces the silent fallback with a named
  chain — `workingDirectory.ensure` → `session.header.cwd` → `config.workspace` →
  `DSH_RESEARCH_WORKSPACE` → `process.cwd()` — returns `{cwd, source}`, and
  **throws** when the answer is inside `node_modules` unless it came from
  configuration.
- The `notebook` tool now prints `journal: <path> (workspace from <source>)`, so a
  wrong resolution is visible on the first record instead of after a lost month.
- `provenance.js` no longer keeps its own copy of the resolver; `scaffold`,
  `survey`, `telemetry` pass the bundle configuration through, and `index.js`
  makes a bundle-level `workspace` the default for every slice.

## 0.8.0 — the same classifier for someone else's project

- Universal layer `packs.js`: file kinds and directory roles are derived from
  content (magic bytes, text sniffing, extensions, what a directory contains),
  not from names alone. Four packs ship as JSON — `numeric-openfoam`,
  `experiment`, `custom-code`, `literature` — and a project can override them in
  `<project>/.dsh/packs/*.json` without forking the plugin.
- Roles (`run`, `raw-data`, `derived`, `analysis`, `paper`, `literature`,
  `talks`, `admin`, `archive`, `empty`, `mixed`) are universal; the scaffold
  skeleton follows them, so a literature-only project gets no `runs/`.
- Unrecognised names are reported (`unknownNames`, top-20 with counts) instead of
  being guessed; plain text is not treated as a kind, so the names stay visible.
- Measured on the 21-project corpus: unclassified files **44.3 % → 5.2 %**, same
  wall time, nothing written into the projects; journal capped at 64 KB with the
  full lists left in `map.md`/`tree.json`.
- `fixtures/adoption.mjs`: five archetypes (measurements, sources, hand-written
  solver, mixture, unrecognisable) as the acceptance test for every universal
  change; `smoke-adopt.mjs` grows to 77 checks.

## 0.7.0 — adopting an existing project

- `survey.js`: `project_survey` (bounded walk, file kinds, facts a file proves,
  run-like / paper-like / literature-like / empty directories) and
  `project_adopt` (`as-is` / `light` / `restructure`, plan by default).
- Archival journal that separates facts, guesses and the plan, with the map and
  the machine-readable tree beside it.
- `skills/project-adoption/SKILL.md`: the order of operations — read, survey,
  verify, journal, three plans, owner picks, one step at a time — and the rules
  that outrank the plan (no deletion, no raw-data writes, decision per move).
- Nothing is moved, renamed or deleted by the plugin; `apply` writes only the
  additive parts.

# Changelog

One line per release: what changed and why it matters. The build log
(`dsh-research-record-build-log.md`) keeps the API facts each change relied on;
this file keeps the story a user can read.

## 0.6.0 — usage report

- `telemetry.js`: per-call usage events (`<ws>/.dsh/usage/events.jsonl`) with tool
  name, success, duration, session hash, role, model, argument *names*, sizes and
  error shapes — never argument values or file contents.
- `usage_report` tool and `/usage-report` command: per-tool calls, error rate and
  latency, the journal funnel (hypothesis → method → observation → decision),
  unused routes, and suggestions that state their evidence.
- `action: "export"` writes Markdown + JSON into `.dsh/usage/`, safe to send to a
  maintainer (project basename only, no absolute paths).
- `docs/IMPROVING.md`: how to add a tool, a skill, a recommendation or a route;
  the invariants that must survive a change; how to read the report; the change
  loop; where the next improvements probably are.
- `smoke-usage.mjs` (57 checks), including the privacy assertions.

## 0.5.0 — figures

- `figurelib/` — Python port of the journal style: 90/190 mm sheets, 50 mm panel
  height, Linux Libertine O 8 pt, measured footer band for a shared legend,
  bilingual RU/EN loop, data tables next to the figure.
- `figure_spec` (geometry before drawing) and `figure_check` (page size, embedded
  fonts, warnings) — a figure is verified, not hoped for.
- `skills/matplotlib-figures`, `docs/FIGURES.md`.

## 0.4.0 — installing the stack and routing tasks

- `research_stack` tool and `/research-stack` command: show the recommended
  plugins by level, or install them (`confirm: true`) — nothing is installed
  silently.
- `ROUTING` table plus a prompt section: which tool answers which question, so a
  task does not start with hand-written parsing when a tool exists.
- `docs/RECOMMENDED.md` with levels, install commands, and what not to install.

## 0.3.0 — recommendations

- `stack.js`, `docs/RECOMMENDED.md`, `smoke-stack.mjs`: verified package list with
  reasons, conflicts, gaps in the ecosystem and packages to avoid.

## 0.2.1 — scientific honesty rules

- `AGENTS.md` template: "do not invent — verify" and "the script computes", plus
  a "check instead of guessing" section; the identity prompt repeats both, and
  the `research-record` skill puts them above the journal discipline.

## 0.2.0 — research project scaffold

- `scaffold.js`: `research_init` tool and `/research-init` command create the
  project tree (literature, hypotheses, models, runs, data, analysis, paper,
  talks, admin), the forms, `AGENTS.md`, `policy.json` and the marker
  `.dsh/research-project.json`; existing files are never overwritten.
- Prompt section `research-project-identity` makes the directory self-describing.

## 0.1.1 — attribution and automatic notes

- Actor attribution: `role` (lead/subagent) and the real model per step.
- Automatic artifact notes (`auto: true`) — stubs with paths and hashes, one per
  step, deduplicated across the project.
- `lock.js`: append lock, because `appendFile` is not atomic for long lines and a
  journal line with a long body interleaves.

## 0.1.0 — the record

- Hash-chained journal (`notebook`, `notebook_search`, `notebook_verify`) with
  evidence gates: `completed` without evidence is downgraded to `unverified`.
- Provenance graph (`provenance_of_file`, `provenance_verify`).
- Guard (`policy_status`): protected paths, destructive-command confirmation,
  audit log.
