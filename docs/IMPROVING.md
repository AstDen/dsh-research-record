# Improving the plugin

This bundle is meant to be changed — by its author, by a colleague who hit an
edge of the workflow, or by a model asked to "make it better". This file is the
map for that work: what each file owns, how to add a capability, what must stay
true after the change, and how to read the evidence that tells you what to
change next.

Everything here is deliberately small: one file per concern, no framework, no
generated code. A change should be readable in a diff without the surrounding
explanation.

## Where things live

| File | Owns | Data it writes |
| --- | --- | --- |
| `index.js` | package entry: mounts all plugins | — |
| `notebook.js` | journal records, hash chain, digest section, automatic artifact notes | `<ws>/.dsh/notebook/<session>.jsonl`, `supersede.jsonl` |
| `provenance.js` | per-step tool activity graph, derived files, verification | `<ws>/.dsh/provenance/<session>/steps.jsonl` |
| `guard.js` | protected paths, destructive-command confirmation | `<ws>/.dsh/policy.json`, `<ws>/.dsh/guard/blocked.jsonl` |
| `scaffold.js` | research project layout, `AGENTS.md` rules, `/research-init` | the project tree + `.dsh/research-project.json` |
| `stack.js` | recommendations, routing, `research_stack` install tool | nothing (reads the registry) |
| `figures.js` | figure geometry planning and PDF verification | nothing (calls `figurelib/`) |
| `figurelib/` | Python: style, layout, bilingual loop, tables, PDF check | figures and data tables |
| `telemetry.js` | usage events and the effectiveness report | `<ws>/.dsh/usage/events.jsonl`, `report-*.md/.json` |
| `client.js` | web panels (journal, provenance, policy) | — |
| `lock.js` | append lock, used by every JSONL writer | `<file>.lock` |

Rule of thumb: **state belongs to the research project, not to the profile.** A
colleague who copies the project directory must keep its journal, provenance and
usage history; a profile reinstall must not lose them.

## Adding a tool

1. Pick the module that owns the concern — a new file only if the concern is new.
2. Register inside that module's `apply(ctx, config)`:

```js
ctx.tools.register({
  name: 'verb_noun',                       // snake_case, one topic, no duplicates
  description: 'what it does, when to use it, and what it refuses', // this is the prompt
  parameters: { type: 'object', properties: { /* … */ }, required: [] },
  output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: value.text }] },
  async execute(args, exec) { /* exec.agent, exec.signal are available */ },
})
```

3. The description is the interface: a model decides from it alone. Say what the
   tool answers and what it refuses ("never reads a whole PDF — `pdf_info` first,
   then `pdf_text` per page"). A vague description shows up later as "called once
   and abandoned" in the usage report.
4. Return a `text` field and let `render` format it; do not return raw JSON blobs.
5. Resolve the working directory through `activeWorkspace(ctx, exec)` — never
   `process.cwd()`, which is the server's directory, not the researcher's.
6. Write JSONL through `appendLine` from `lock.js`: two writers appending long
   lines interleave and break a hash chain.

## Adding a skill

A skill is `skills/<kebab-name>/SKILL.md` with YAML front matter (`name`,
`description`) and a body that is instructions, not documentation. Keep the
`description` answering "when should this load" — that string is the only thing
the model sees before it decides.

Skills ship inside the package (`skills` is in `files`), so an installed bundle
gives the skill to every session that visits the project.

## Adding a recommendation or a route

`stack.js` has two lists:

- `STACK` — one record per capability: `id`, `title`, `level`
  (`core|optional|situational`), `verified` (date the registry was checked),
  `why`, `packages` (exact specs, scoped names allowed), `install`, `note`,
  `conflicts`.
- `ROUTING` — `[task, 'tool_a → tool_b; tool_c for …']`. `routeTools()` parses
  the tool names out of the second column, and the usage report uses them to
  report a route that never fired.

`smoke-stack.mjs` fails if an entry has no `why`, an unknown level, no `verified`
date, an install command that omits one of its own packages, or if `AVOID` and
`STACK` overlap. Those checks exist because a recommendation without a reason is
worse than no recommendation: the user cannot tell whether it still holds.

`AVOID` is the other half of the value — "not to install, and why" (wrong OS,
duplicate tool names, extra compilers racing on `.aux`, a second Zotero client).
Keep it when adding to `STACK`.

## Invariants — break these and the record stops being evidence

1. **The journal is append-only.** A correction is a new record with
   `supersedes`; never edit a line in place.
2. **`hash = sha256(canonical JSON without hash)`**, `prevHash` = the previous
   line's hash, genesis = 64 zeros. Any writer must go through `hashRecord` and
   `appendLine`.
3. **Provenance is observed, not declared.** It is built from `tools/result` and
   `tool/call` events; there is no tool that writes edges by hand.
4. **The guard errs towards refusing.** A false denial costs one retried
   command; a false allow silently rewrites raw data. Do not "fix" a false
   positive by loosening the classifier — write through `write`/`edit` instead.
5. **Telemetry never carries content.** Tool names, argument *names*, sizes,
   extensions and error shapes only. `smoke-usage.mjs` asserts that a recorded
   call does not contain its own argument values; keep that assertion.
6. **Figure geometry is a contract**: one panel 90×50 mm without a letter, two
   panels 190×50 mm with the legend inside, three panels with a measured footer
   band. A figure that violates it is rejected by the journal, not by taste.

## Reading the effectiveness report

`usage_report` (or `/usage-report`, or `/usage-report export`) answers four
questions. Read them in this order:

1. **Which tools carry the work?** Calls per tool, sorted. A tool with one call
   and no error is usually a description problem, not a missing need.
2. **Which tools fail?** `errorRate ≥ 20 %` with at least three calls is a
   defect: the report prints the most frequent error text, which is usually
   enough to see whether it is a bad argument, a missing binary or a wrong
   assumption in the description.
3. **How far does the workflow get?** The journal funnel
   (`hypothesis → method → observation → decision`). Hypotheses without
   observations mean runs are not recorded; observations without decisions mean
   conclusions are not made; a mostly-`auto` journal means the automatic notes
   are doing the work the model should do.
4. **Which routes never fire?** Either the capability is not needed, or it is
   not installed, or the routing text does not match what the model asks for.

The suggestions section states its evidence for each item. If an item cannot be
checked against the numbers above, it does not belong there.

## The change loop

```bash
node --check *.js                        # syntax, no bundler needed
node smoke.mjs && node smoke-fixes.mjs && node smoke-client.mjs \
  && node smoke-scaffold.mjs && node smoke-stack.mjs \
  && node smoke-figures.mjs && node smoke-usage.mjs
python3 -m py_compile figurelib/*.py
```

Then:

1. bump `version` in `package.json` (patch = fix, minor = new tool/skill/record);
2. add a line to `docs/CHANGELOG.md` — what changed and why, one sentence;
3. document the change where a user would look (`docs/DETAIL.md` for behaviour,
   `docs/IMPROVING.md` for maintainers, `docs/RECOMMENDED.md` for the stack,
   `docs/FIGURES.md` for figures);
4. append a step to `dsh-research-record-build-log.md` with the API facts the
   change relied on (file and line) — the next change will need them again;
5. restart the profile: the tool catalogue and prompt sections are fixed per
   session, so a saved file is not a changed chat.

## Sending a report to the maintainer

`/usage-report export` writes two files under `.dsh/usage/`:

- `report-<stamp>.md` — the readable report;
- `report-<stamp>.json` — the same numbers, plus `privacy` describing what is
  and is not inside.

Both contain the project *basename* only, no absolute paths, no argument values,
no file contents, no journal text. A colleague can attach them to an issue, and
the maintainer can compare two projects by the same fields.

## Where the next improvements probably are

Ordered by what the reports can already prove, not by ambition:

1. **Journal discipline hooks** — if `hypothesis` records appear without
   `observation`, add a pre-step nudge (a prompt section that names the open
   hypotheses of the project) rather than a new tool.
2. **Figure audit** — `figure_spec` and `figure_check` catch geometry and fonts,
   not "this figure is illegible". A checklist pass over the rendered page (the
   skill already tells the model to look) is the cheapest next step.
3. **Table → figure path** — `save_data_table` sits next to the figure; if the
   usage report shows `figure_*` without `save_data_table`, the skill should
   require the table for every published figure.
4. **Evidence packages** — the journal and provenance are already hash-chained;
   a ZIP with cited file versions and a verification script is a packaging
   exercise on top of existing data, not new machinery.
5. **Collaboration** — the report is per project. Comparing several projects
   (a lab, not a researcher) needs a merge tool, and that is a separate plugin
   so the single-project story stays simple.
