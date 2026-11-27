---
name: research-record
description: Keep the research record honest — write a hypothesis before the run, a method with parameters, an observation with numbers and artifact paths, a decision with its reason, and corrections through supersedes. Load when the session computes, measures, or concludes something that must be reproducible later.
---

# Research record

The notebook is a hash-chained journal under `<workspace>/.dsh/notebook/`. It is
the only memory that survives a context compaction, so the discipline is not
bookkeeping — it is what keeps the numbers trustworthy tomorrow.

## What to write, and when

| Kind | When | Minimum content |
| --- | --- | --- |
| `hypothesis` | **before** the run | `title` = the falsifiable claim; `body` = why it should hold and what would disprove it |
| `method` | before or with the run | parameters, seeds, versions, mesh/solver settings, the exact command; put the script in `code` |
| `observation` | after the run | numbers **with units**, `artifacts[]` with the path of the log/CSV, `execution.evidence` = the log that proves the run happened |
| `decision` | whenever a path is chosen | `title` = the decision, `body` = the reason, and what was rejected |
| `note` | anything else | still link the records it leans on through `evidence` |

`outcome` is only for `observation` and `hypothesis`:

- `signal` — the effect was seen (give the number);
- `null` — looked and found nothing (this is a result, not a failure);
- `inconclusive` — data cannot separate the options;
- `technical-failure` — the run broke; record the error, then fix and re-run.

A broken run is **never** "no result". It is `technical-failure` with the error
goes in `body`, so the next attempt does not repeat it.

## The evidence rule

`execution.state=completed` is accepted only together with
`execution.evidence` — a path to the log or CSV that proves the execution. Without
it the server downgrades the record to `unverified` and says so in `warnings`.
Do not fight the gate: either point it at the file or record the run as
`attempted`.

`artifacts[].path` is hashed when the record is written and re-hashed when it is
read. A `missing` artifact means the number has no source any more: re-derive it
before citing it.

## Corrections

Records are immutable. To change a conclusion, write a new record with
`supersedes: "<old id>"` and explain the reason in `body`. The old record stays
in the chain (that is what makes the chain verifiable) and readers see
`supersededBy`.

## Before trusting an old number

1. `notebook_search query="<topic>"` (add `scope: "project"` to search every
   session in the workspace) — read the record with `action: "read"` and its
   `expectedDigest` if someone else may have touched the file;
2. check `artifacts[].status` — `changed`/`missing` invalidates the number;
3. `provenance_of_file path="<artifact>"` — which step produced it, from what
   inputs, `observed` or `inferred`;
4. `notebook_verify` before a report if the journal is the evidence.

## Two rules that outrank everything else

**Do not invent — verify.** A path is cited only after `ls`, `test -f` or reading
the file. A number is cited only together with the file, script output or log it
came from. A command that was not run is not described as if it was. When a check
fails, say what was looked for and what was found instead of filling the gap with
a plausible answer.

**The script computes.** Every conversion, mean, difference, ratio, integral,
fit or unit change runs as a script under `analysis/scripts/` (or the project's
equivalent), and the answer quotes its output. Arithmetic performed in the reply
or in manuscript text is a defect: nobody can re-run it, and a wrong digit
travels into the paper. If a number must appear, the script that produced it must
exist and be named next to it.

## Guard

`.dsh/policy.json` protects input paths (`user_data/**`, `data/**` by default
configuration). Writes there are denied; work on a copy under `derived/` and
record the derivation step. Destructive shell commands ask for confirmation.
`policy_status` shows the active policy and what it already blocked.
