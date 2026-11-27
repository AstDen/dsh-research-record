## 0.8.4 — the published package carries every module it imports

`services.js` was missing from `package.json` `files`, so a package installed
from the repository (rather than from a clone) failed at import with
`Cannot find module …/services.js`: `notebook`, `guard`, `provenance`,
`scaffold`, `stack` and `telemetry` all import it. Installing from a workspace
symlink hid this — the symlink has every file, the tarball does not.

- `services.js` added to `files`; `npm pack --dry-run` now contains all sixteen
  runtime modules (`51` files, `services.js` included).
- `M18` in `smoke-regress.mjs`: every module a root module imports through
  `./x.js` must be covered by `package.json` `files`; the suite is 49 → 50
  checks. It fails on the 0.8.3 manifest.

## 0.8.3 — the guard reads where a command actually writes

Two misses found by probing the real classifier rather than reading it:
`cd data && rm raw.csv` reported `raw.csv` (resolved at the workspace root, so
the write looked innocent), and a script handed to an interpreter through a
heredoc reported nothing at all.

### The guard

- `bashCandidates` splits a command into list/pipeline segments and tracks `cd`,
  so a relative destination resolves against the directory the command is in; an
  absolute `cd` keeps an absolute candidate, and a `cd` that leaves the workspace
  stops the guess instead of inventing a path.
- `bashUnverifiable` recognises `<<'DELIM'` fed to an interpreter (`python3`,
  `node`, `perl`, `ruby`, `php`, `Rscript`, a shell) and the guard **asks** before
  it runs — the body is data to a token scanner, so a silent pass would be a
  guess. An empty heredoc and a heredoc into `cat`/`tee` stay silent: the latter
  is checked by its destination like any other redirect.
- The verb itself is no longer reported as a destination: `cd data && rm raw.csv`
  yields one candidate (`data/raw.csv`), not `data/rm` as well.
- `M16` (five checks) and `M17` (five checks) in `smoke-regress.mjs`; that suite
  is 39 → 49 checks.

### Identifiers are monotone within a millisecond

`ulid()` increments its random tail when called twice in the same millisecond, so
two records created together compare in creation order. Without that, the search
tie-break — which uses the identifier when `createdAt` matches — put the older
record first about half the time; the `Small` case caught it intermittently.

## 0.8.2 — the fixes the audit asked for, each with a test that failed before it

An external audit of 0.8.1 (commit `57c0cc8`) found one blocker, eight high and
fifteen medium defects; every one is reproduced by a script first, then fixed.
The full report is `dsh-research-record-audit/report.md`, the plan is
`fix-plan.md`, the acceptance evidence is `retest-report.md`.

### The test infrastructure that would have caught them

- `fixtures/ctx.mjs` — a cordis-faithful context: reading a service the plugin
  did not declare in `inject` **throws**, exactly like `ReflectService`. The old
  flat fake returned `undefined` instead, which is why the worst defect of 0.8.1
  passed 365 green checks.
- `smoke-cordis.mjs` — the same claim proved on the real `@deepseek-ai/cordis`
  loader (services registered as `Service` subclasses, because `app.provide` of a
  plain object does not reproduce the throwing getter).
- `smoke-regress.mjs` — one case per audit finding (`B1`, `H2`–`H8`, `M1`–`M9`,
  `M13`, `M14`); `npm test` runs it together with the eight existing suites.

### Blocking

- **`B1`: a journal with a torn tail was silently appended to.** One `truncate`
  left half a line, the next `notebook` returned `ok: true`, and every later
  record was unreachable — `notebook_verify` reported "line 1 is not valid JSON".
  Now `appendRecordOnce` refuses (`TORN_TAIL`, with the byte offset) and
  `notebook_verify({ repair: true })` trims to the last consistent record after
  copying the file to `<journal>.bak-<timestamp>`.

### High

- **`H1`: `ctx.workingDirectory ?? ctx.get('workingDirectory')` never reached the
  right branch.** cordis throws on the *property read*, so the fallback was dead
  code and nine places resolved the wrong workspace — the live symptom was a
  journal written into `/home/claster` instead of the project. New
  `services.js#getService` tries `ctx.get(name)` first and only then the property.
- **`H2`: twelve parallel `notebook` calls broke the hash chain.** `appendRecordOnce`
  held the lock and then called `appendLine`, which takes the same lock, waited
  out its retries and finally wrote *without* it. The record is now appended with
  `appendFile` inside the single lock.
- **`H3`: a forged record passed `notebook_search`.** `action: "read"` compared
  `expectedDigest` with the stored `hash` field instead of recomputing it, so a
  hand-edited title came back with `ok: true` while `notebook_verify` saw the
  mismatch. The read now recomputes and reports both digests.
- **`H4`: survey markers escaped the project.** `markerName: "../OUTSIDE.md"`
  overwrote a file above the project; `markerName: "notes.md"` overwrote
  `sub/notes.md`. Markers must be bare file names and are written with
  `flag: "wx"`, so an existing file is reported as skipped, never replaced.
- **`H5`: adoption overwrote the owner's `literature/_INDEX.md`.** Adoption never
  overwrites: the index is written only when absent (`created`), otherwise it is
  kept and reported (`kept`).
- **`H6`: two sessions looked like a time paradox.** The monotonicity check used
  one `previousTimestamp` for every session, so an older record in a second
  session produced `ok: false` with a phantom "goes back in time". The state is
  now per session (`previousBySession`), and the message names the session.
- **`H7`: the figure check could not see a Type 3 font.** `_fonts` read only
  `/BaseFont` (a font may be named and never embedded), and pdffonts output was
  split on single spaces, so `"Type 3"` arrived as `"Type"` and the comparison
  never matched. Now `/FontFile*` presence and `/Subtype /Type3` are read from
  the PDF bytes, and the pdffonts columns are split on runs of spaces.
- **`H8`: the HTTP panels read the journals of any directory.** `/notebook` and
  `/provenance` took `?workspace=` and called `process.cwd()` as the default.
  `panelWorkspace` accepts only a workspace a live session works in (or the host
  directory) and answers **403** otherwise.

### Medium

- **`M1`: the guard classified shell commands by substring.** `rm -r -f user_data`
  and `rm -Rf data` were allowed, `python3 analyze.py data/raw.csv` was denied
  (reading!), and `sed -n 1p` was denied too. The classifier now reads the verb
  (`rm`, `mv`, `cp`, `dd`, …) and treats its non-flag arguments as write targets;
  an interpreter counts as a writer only with `-i`.
- **`M2`: the scaffold protected its own output.** It wrote
  `protectedPaths: ["data/raw/**", "data/**"]`, so `data/derived/` — the place its
  own `AGENTS.md` sends the work — was refused. Both now agree, and the guard has
  an `allowPaths` exemption list.
- **`M3`: `max_files` did not stop the walk.** The limit ended one directory, not
  the traversal. The walk breaks at the limit and reports `truncated: true`.
- **`M4`: adoption wrote outside the workspace.** `root` was used unresolvable
  against the workspace; a path outside it now fails with a named error.
- **`M5`: a malformed project pack disabled both survey tools.** `nameMatches`
  went through `new RegExp` without the `safeRegExp` helper that the same file
  already had; an unparsable pattern now skips one signature instead of throwing,
  and no longer degrades into "match everything".
- **`M6`: a failed write recorded the old file as its output.** The provenance
  hook hashed the path after an `isError` write — so the step claimed the previous
  content as its result. A failed write records a note and no edge.
- **`M7`: `steps.jsonl` stored file content.** `write.content`,
  `edit.old_string`/`new_string` went into the journal verbatim (up to 4 KiB
  each), which a report or a commit then carries around. Content is now recorded
  as `{ redacted: true, chars: N }`; other long arguments keep a 1 KiB preview.
- **`M8`: `touch -r` hid a change.** Change detection compared size and mtime, so
  restoring the timestamp made a modified file look untouched. ctime is now part
  of the fingerprint.
- **`M9`: the first `bash` after start saw no outputs.** The "before" snapshot was
  taken lazily when the result arrived, i.e. after the command. It is now started
  on `tool/call` and awaited by the step; a file whose mtime falls inside the
  call window is treated as written by the call even if the asynchronous pre-scan
  already saw it (5 ms of slack covers ISO-millisecond vs sub-millisecond mtime).
- **`M10`: the lock gave up and wrote unlocked.** `withAppendLock` ran the body
  without a lock after two seconds of retries, which is how `H2` broke the chain.
  It now throws `LOCK_TIMEOUT` instead, releases only its own token, and waits up
  to 60 s.
- **`M11`: no input limit on `notebook`.** A 5 MiB body was accepted. The input is
  capped at 512 KiB and an aborted turn is refused before the write.
- **`M13`: `research_stack` with `level: "all"` printed only the footer**, and
  install commands lost local path specs. `"all"` now means every level (with the
  "do not install" and "does not exist" blocks), registry packages exclude local
  checkouts, and a local checkout is reported as a manual command instead of a
  name `dsh plugin add` cannot resolve.
- **`M14`: the telemetry sanitiser missed Windows paths.** The pattern required
  two literal backslashes, so `C:\Users\bob\…` survived into the report.
  `/home/<user>`, `/Users/<user>` and both Windows forms now collapse.
- **`M15`: `research_init` wrote into any directory it was given**, appended to an
  existing form without saying so, and `force: true` replaced a hand-edited
  `PROJECT.md` with no copy of the old text. The tool now refuses a path outside
  the session workspace (the same containment the panels and the survey use),
  reports a modified form as `updated` instead of inventing the label
  `PROJECT.md (вопрос)`, and keeps `<form>.bak-<timestamp>` before a forced
  rewrite.

### Acceptance, measured on the restarted host

A page reload does not load a new host build — the loader reads plugins once — so
the live check needed the process restarted. After it: `policy_status` reports the
session project instead of the home directory, `notebook` writes to
`<project>/.dsh/notebook/` and says `workspace from workingDirectory`, and
`/notebook?workspace=/tmp` answers 403 where 0.8.1 answered 200.

### Small

- The search tokenizer no longer drops CJK text, and `limit: "5"` is read as five
  rather than silently ignored.
- `survey` skips `.git` without skipping `.github`, and reports skipped symlinks
  instead of dropping them silently.
- The scaffold reports real paths only: the label `PROJECT.md (вопрос)` became a
  journal artifact that could never be hashed. A record's artifacts are also
  stat-checked, so a non-file can never enter the journal again.
- `figurelib/table.py` works without pandas.
- `figure_spec` puts a single panel on the 90 mm column by default (it was
  returning a 190 mm sheet with the legend outside, contradicting the documented
  contract) and keeps the legend inside the panel.
- `provenance_of_file` no longer calls the file it just wrote a "previous version":
  a pre-scan that runs next to a fast `bash` command can hash the file after the
  write, and an input hash equal to the output hash means two versions with the
  same bytes. Such an edge is reported without a previous hash.
- `__pycache__/`, `.dsh/` and `.tmp/` are gitignored.

### Documentation, packaging and language

- **The bundle speaks English.** Every message, comment, doc, skill, fixture and
  test outside the localisation layer was translated. What legitimately stays
  Russian is data: `locale/ru.json`, the client's `ru` dictionary, the bilingual
  unit glossary and panel-letter tables of `figurelib/`, the guard's bilingual
  confirmation prompt, the `экспорт` alias of the usage-report action, and the
  Russian folder names the survey packs still recognise (`литература`,
  `статьи`, `заметки`, …).
- **A new icon** — graduate cap, magnifier and notebook, drawn from primitives
  only, legible at 48 px.
- **CI exists**: `.github/workflows/test.yml` runs the whole suite on Node 22 for
  every push and pull request, installing `matplotlib`/`numpy` for the figure
  tests.
- **`package.json` is publishable**: `repository`, `author`, `homepage`, `bugs`
  and `engines.node` were `null` and now carry real values; `scripts/` is in
  `files`.
- **The install instructions work**: the README no longer tells a new user to
  `dsh plugin add dsh-research-record` (nothing is published to npm); it gives a
  local clone and a `git+https://` specifier, states the requirements, adds a CI
  badge and a “First five minutes” walkthrough.
- **`docs/READINESS.md`** — what works for an outside user, what does not, and
  what to add before advertising the bundle (a package or tarball, `SECURITY.md`,
  an issue template).
- **`docs/releases/v0.8.2.md`**, **`scripts/github-metadata.sh`** and
  **`scripts/store-github-token.sh`** — the release notes, the script that sets the
  repository description, homepage, topics and the GitHub release from them (it
  prints what to paste instead of failing when no token is present), and the helper
  that stores a token in a 600-mode file from a hidden prompt. The metadata script
  reads `GH_TOKEN` or that file (`~/.config/dsh-research-record/gh-token`, override
  with `GH_TOKEN_FILE`), refuses a mode looser than 600, and verifies the token
  against `GET /user` before it changes anything — so a secret never has to appear
  on a command line, where the shell would keep it in its history.
- **No bytecode in the repository.** Five `figurelib/__pycache__/*.pyc` files had
  been committed — `.gitignore` lists `__pycache__/`, but an ignore rule does not
  apply to a file already tracked. They are removed from the index and stay out.

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
