---
name: project-adoption
description: Take over an existing research directory that someone else built — survey it, leave a map, write an archival lab notebook that separates facts from guesses, then offer to fit in (change nothing / add alongside / restructure with approval). Load when the session opens in a project that already has years of files, half-finished runs, or results nobody wrote up.
---

# Adopting an existing research project

The directory is older than the harness. Someone worked in it for years: a study
that ended in negative results, an experiment nobody wrote up, a copy of a copy of
a dataset, and the thing they are working on right now — often in the same folder.
They ask you to "sort it out". Sorting it out by moving files is how trust is
lost.

The order is fixed: **map → facts → archival journal → three plans → owner picks
→ one small step at a time.** Nothing is renamed, moved or deleted before the
owner chooses a mode, and even then only with their approval per step.

## Step 0 — read, do not touch

Do not start with `ls -R` and do not open files at random. Ask two questions
first, because they change everything:

1. Which part is the work in progress right now?
2. What must never be moved (raw data, published results, a manuscript under review)?

If the owner cannot answer, say so and continue: the map is exactly what helps
them answer. Record their answer as a `decision` in the lab notebook — it will be
the reason a later move happened.

## Step 1 — survey once

`project_survey` walks the tree within limits, classifies files by kind and
extracts the facts a file proves (first line of a CSV → its columns, `\title{}` of
a `.tex`, cell count of a notebook). Nothing is written unless `apply: true`, and
even then only `.dsh/map/map.md` and `.dsh/map/tree.json`.

- Large tree: keep `max_files` at 20000 and `max_depth` at 6; raise only when the
  map says the walk stopped and the owner needs the deeper part.
- Markers: `markers: true` writes a small `.dsh-map.json` into every visited
  directory so the graph survives a `cd`. It also writes into the owner's folders,
  so **ask before enabling it** — it is a visible change in their tree.
- The map is a hypothesis about structure, not knowledge. A directory named
  `results_old` proves nothing.

## Step 2 — verify the claims you intend to use

Before any fact enters the journal, open the file: `pdf_info` for a PDF,
`data_profile` for a table, `head`/`Read` for text, `latex_look` only for a real
build. A folder with a `.tex` and no PDF is a manuscript that never compiled; a
`.csv` named `final` with three rows is not a result.

Write down only what the file shows. "Есть таблица с колонками `R, T_s, u`" is a
fact. "Это основной результат" is a guess and gets marked as one.

## Step 3 — the archival lab notebook

Two outputs, same content, different consumers:

- `.dsh/map/archival-journal.md` — the document the owner reads and can print;
- journal records via `notebook` — the hash-chained record that survives
  compaction and feeds the digest:
  - `method` — how you surveyed (limits, what was skipped, why);
  - `observation` — one per fact cluster, with `artifacts` pointing at the files
    that prove it (`execution.evidence` where a run is involved);
  - `note` — the guesses ("this looks like an abandoned run", "this table has no
    script"), tagged `hypothesis`, with confidence `low` unless verified.

Structure of the document (the tool writes this skeleton, you fill the meaning):

1. **Карта** — counts by kind, run-like/paper-like/literature-like directories,
   empty directories, what was not read.
2. **Факты** — each with its path.
3. **Оценки** — each marked as a guess, with what would confirm it.
4. **План встраивания** — the three modes.
5. **Как переносить** — one step at a time, `decision` per step, `notebook_verify`
   after each.
6. **Что спросить у владельца** — the questions whose answers you do not have.

Never write "проект в плохом состоянии" — write what is there and let the owner
judge. The point of the archival journal is that it keeps working after the
conversation is forgotten.

## Step 4 — three ways to fit in, strongest fit first

`project_adopt` builds all three plans; show them as a choice, not a lecture.
The strength refers to how much of the owner's structure survives:

| Mode | What changes | Risk | When to offer |
| --- | --- | --- | --- |
| `as-is` — встроиться как есть | only `.dsh/` (map, journal, policy) + an `AGENTS.md` pointer; not one folder is added | none | an established colleague, a project under review, a tree they are proud of |
| `light` — встроиться легко | adds missing standard folders (`literature/ hypotheses/ models/ runs/ analysis/ paper/ talks/`) and `literature/_INDEX.md` listing what already exists; moves nothing | low — additive only | the usual case: the owner wants order but not to touch files |
| `restructure` — перестроить | lists candidate moves (PDF → `literature/refs/`, tables+logs → `runs/<id>/results/`, images → `analysis/figures/`, `.tex` → `paper/`, meshes → `models/`); performed later, one directory at a time | high — the owner is the only one who can tell a dead run from the run behind a figure | the owner says "I cannot find anything any more" and accepts the cost |

Quote the owner's scale when they used one: «сильно встроиться — ничего не
переделывая» is `as-is`, «средне — немного переделывая» is `light`, «слабо —
многое переструктурировать» is `restructure`. Do not silently upgrade a mode.

`apply: true` writes only the additive parts: map files, archival journal,
`.dsh/policy.json` (if absent), `AGENTS.md` (if absent — it is never overwritten),
and for `light`/`restructure` the standard folders plus the index. Moves and
deletions are never performed by the tool.

## Step 5 — restructure, when chosen, one step at a time

For each group from the plan:

1. Show the exact list of files and the destination.
2. Get an explicit yes for that group only.
3. Move with `mv` (approval will be requested), keeping the destination inside the
   project and never touching `data/raw/**` — the guard denies it, and the denial
   is correct.
4. Write a `decision` record: what moved, from where, why, and what the owner said.
5. `notebook_verify` after the group.

If a move fails half-way, stop, record `technical-failure` with the error and the
list of what already moved. Do not "fix it quietly".

Protect the owner from the two classic disasters:

- **the copy of a copy** — same name and size in two places: flag it in the
  journal, never delete; let the owner decide (hash both first, with a script);
- **the empty folder that mattered** — an empty directory may be a placeholder or
  a lost result: check `git log`/`.gitignore` before declaring it useless.

## Step 6 — start working, not just organising

After adoption, seed the project from what was found:

- `hypotheses/registry.md` entries from the archival journal, each marked
  "унаследовано" with the path of the evidence;
- one `hypothesis` record per surviving open question, one `method` for the next
  step (not for the old work);
- if a manuscript exists, `latex_look` it once to see whether it builds — a build
  failure is a fact worth recording now, not the day before submission.

## Rules that outrank the plan

1. The owner's tree is data. Read it, do not rewrite it.
2. A directory name is not evidence; only a file that was opened is.
3. Guesses go into the journal marked as guesses, with what would confirm them.
4. Nothing is deleted — not a duplicate, not an empty folder, not an archive.
5. `data/raw/**` is read-only; work happens on copies, and the derivation is
   recorded.
6. Every move has a `decision` record and a `notebook_verify` after it.
7. If the tree is too large or too ambiguous, say what was not read and produce a
   plan for the part you did read. A partial map that admits its limits beats a
   confident summary of unopened files.
