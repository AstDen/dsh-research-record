# Retest after the 0.8.1 audit

The audit of 0.8.1 (`57c0cc8`) found one blocker, eight high and sixteen medium
defects, plus a list of small ones. This document is the acceptance evidence for
0.8.2: for every finding, what was wrong, what the code does now, and the
assertion that fails without the fix. The audit itself is in the repository's
sibling directory `dsh-research-record-audit/report.md` (not shipped).

## How it was tested

| Step | Command | Result |
| --- | --- | --- |
| 1. syntax | `node --check` over `*.js`/`*.mjs`, `python3 -m py_compile figurelib/*.py` | clean |
| 2. suites | `npm test` (8 suites + cordis + regress) | exit 0, 0 failures |
| 3. acceptance | `node ../dsh-research-record-audit/verify-fixes.mjs` | 23/23 findings `FIXED` |
| 4. legacy data | `node ../dsh-research-record-audit/check-legacy-journal.mjs` | 5/5 journals written by 0.8.1 verify unchanged |
| 5. live host | restart, then the tools in a project session | `/notebook?workspace=/tmp` → **403**, journals land in the project, `policy_status` reports the project |
| 6. load | not met — see "Deferred" below | — |
| 7. live instance | second instance (`--port 3099 --no-open`) | `/notebook?workspace=/etc` → **403**, own workspace → 200 |

The numbers before and after: the regression suite started as **3/14** (the
three that passed were the ones whose fixtures did not reach the defect) and now
holds **38/38**. `smoke-figures` went 31 → 32 assertions, the rest stayed.

Why the old suites were green: they ran on a flat fake context whose services
were plain properties, so `ctx.workingDirectory ?? ctx.get('workingDirectory')`
looked fine. `fixtures/ctx.mjs` now throws on an undeclared service read, like
cordis does; `smoke-cordis.mjs` proves the same claim on the real
`@deepseek-ai/cordis` loader (6/6), and the eight suites share that fixture.

## Findings

| Id | Fix | Assertion |
| --- | --- | --- |
| B1 | `notebook.js`: `journalTail` + `TornJournalError`; `notebook_verify({repair})` trims to the last consistent record after a `.bak` copy | `B1` ×3, incl. repair |
| H1 | `services.js#getService` reads `ctx.get(name)` first, property second | `smoke-cordis` 6/6 (`resolveWorkspace` = project, `policy_status` = project) |
| H2 | `notebook.js`: append and `prevHash` read under one lock, `appendFile` inside it | `H2` 12 concurrent appends, chain valid |
| H3 | `notebook_search read` recomputes the hash, compares `expectedDigest` with the recomputed value | `H3` ×2 |
| H4 | `survey.js`: `markerFileName` accepts bare names only, `flag: 'wx'` | `H4` ×2 |
| H5 | `survey.js`: `ensureFile` for `literature/_INDEX.md`, reported as `kept` | `H5` |
| H6 | `provenance.js`: `previousBySession` map | `H6` ×2 |
| H7 | `figurelib/check.py`: `/FontFile*` and `/Subtype /Type3` from the bytes; pdffonts split on runs of spaces | `H7` |
| H8 | `notebook.js#panelWorkspace`, used by both routes, answers 403 | `H8` ×2 |
| M1 | `guard.js`: verb-based classifier (`WRITERS`), `-i` for interpreters | `M1` table of 12 commands |
| M2 | `DEFAULT_POLICY.allowPaths` + `matchProtected(…, allowed)`; the scaffold writes the same pair | `M2` |
| M3 | `survey.js`: the walk breaks at `max_files` and sets `truncated` | `M3` |
| M4 | `survey.js#adoptProject`: containment against the workspace | `M4` |
| M5 | `packs.js`: `safeRegExp` on `nameMatches` | `M5` |
| M6 | `provenance.js`: `isError` writes a note, no output edge | `M6` |
| M7 | `provenance.js`: `REDACTED_ARG_KEYS` → `{redacted, chars}` | `M7` |
| M8 | `provenance.js`: ctime joins the change fingerprint | `M8` |
| M9 | `provenance.js`: pre-scan on `tool/call`, `CLOCK_SLACK_MS = 5` | `M9` |
| M10 | `lock.js`: `LockTimeoutError`, owner token, 60 s budget, no unlocked write | `M10` ×2 |
| M11 | `notebook.js`: 512 KiB cap, aborted-signal refusal | `M11` ×2 |
| M13 | `stack.js`: `level: 'all'`, `localEntriesFor`, `shellQuote` | `M13` ×2 |
| M14 | `telemetry.js`: POSIX and Windows home-path patterns | `M14` ×2 |
| M15 | `scaffold.js`: containment, `updated` instead of a labelled phantom, `.bak` before a forced rewrite | `M15` ×3 |
| small | CJK tokenizer, `limit: "5"`, newest-first tiebreak, `.git` vs `.github`, pandas optional | `Small` ×2 |

## Deferred

- **M12 (cost grows with the journal).** Fixed by an index, not by a patch. The
  audit measured 100 000 records / 71.6 MB: `notebook_verify` 1306 ms,
  `notebook_search` 899 ms, append 459 ms, RSS up to 1014 MB. Nothing in 0.8.2
  changes that; the README now states the limit, and this is the 0.9 item.
  Acceptance criterion "100 000 records: verify < 400 ms, RSS < 400 MB" is
  therefore **not met** by this release.
- Remaining small items, deliberately left: the survey map is addressed by the
  workspace rather than the project root; `plan_only` still creates `.dsh/map`;
  CSV headers are split on quotes rather than parsed; a `\title` longer than
  4 KiB is cut; a documented pack schema variant (`packs.js`) still does not
  parse; `dsh` is resolved through `PATH` when the stack is installed;
  `supersede.jsonl` is skipped only in the `catch` path of the telemetry walk;
  an absolute path outside the workspace is hashed by artifact recording.

## Verified on the restarted host

The `link:` install means the profile points at this checkout, so 0.8.2 loads on
the next start — a page reload does not, because the loader has no file watcher
and the host process reads its plugins once. After the restart:

| Check | Result |
| --- | --- |
| `policy_status` | `workspace:` is the session project, not the home directory |
| `notebook` | writes to `<project>/.dsh/notebook/…` and says `workspace from workingDirectory` |
| `~/.dsh/notebook` | no new file appeared |
| `/notebook?workspace=/tmp`, `/provenance?workspace=/etc` | **403** |
| `/notebook` (own workspace) | 200 |

Before the restart the same profile still answered 200 to `/notebook?workspace=/tmp`
and put new records under `~/.dsh/notebook`, which is the 0.8.1 behaviour.

## Second instance (kept as a cheap pre-restart check)

```bash
dsh --profile web --port 3099 --no-open
curl "http://127.0.0.1:3099/notebook?workspace=/etc"          # 403, refuses
curl "http://127.0.0.1:3099/notebook"                          # 200, its workspace
curl "http://127.0.0.1:3099/provenance?path=PROJECT.md"        # 200
```

For contrast, the same first request against the live 0.8.1 process answered
`200` and listed the journals of `/tmp`.
