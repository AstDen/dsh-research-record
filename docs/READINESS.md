# Is it ready for someone else?

**Short answer: yes for a colleague who already runs DSH and can clone a
repository; not yet for a stranger who expects one command to install it from a
registry.**

Nothing here is published to npm, so `dsh plugin --profile web add
dsh-research-record` — the line the README used to print — cannot work. That was
the single real blocker for an outside user, and it is now fixed in the README
(two working install paths) and listed below as the first thing still to do.

## Two different readers

| Reader | Needs | State |
| --- | --- | --- |
| A researcher who already uses DeepSeek Harness | a working install, tests they can run, a first five minutes | **ready** |
| A stranger from a search result | a package they can install without cloning, an issue tracker, a security note | **not yet** |

## The path a new user walks

1. **Finding it.** The repository is public, MIT, with a description, a homepage,
   thirteen topics and an icon. `package.json` had `repository`, `author`,
   `homepage` and `bugs` set to `null`; it now carries them.
2. **Installing it.** `dsh plugin` forwards to pnpm, so a local clone and a
   `git+https://…` specifier both work. The requirements are stated up front:
   DSH `>=0.2.0 <0.3.0`, Node `>=22`, and Python 3 with `matplotlib`/`numpy` only
   for the figure helpers. The profile has to be restarted, because the tool
   catalogue is fixed per session.
3. **Trusting the install.** `dsh --profile web --dump-config | grep
   research-record` must print eight rows. Then `npm test` runs ten suites on a
   clean checkout, and CI runs the same command on Node 22 for every push.
4. **The first five minutes.** `research_init` → `notebook` →
   `provenance_of_file` → `notebook_verify`, written out in the README. If those
   run, the profile is wired: the journal lands in the project's own
   `.dsh/notebook/`, not in `~/.dsh`.
5. **Living with it.** Every state file is inside the project, nothing talks to a
   server, and removal is `dsh plugin --profile web remove` — the project keeps
   its record and stays readable.

## Scorecard

| A new user asks | Answer today | Where |
| --- | --- | --- |
| How do I install it? | clone + `dsh plugin add <path>`, or `add git+https://…` | `README.md` |
| Will it run here? | Node ≥22, DSH 0.2.x; no runtime dependencies | `package.json` |
| Can I check it works? | ten suites, `npm test`, and CI on every push/PR | `.github/workflows/test.yml` |
| What does it actually do? | overview plus a per-tool reference | `README.md`, `docs/DETAIL.md` |
| Will it touch my data? | the guard denies writes into protected paths and logs every denial; no network calls | `guard.js`, README “The guard” |
| Can I prove a number a month later? | hash-chained journal + provenance recorded by a listener, not by the model | `notebook.js`, `provenance.js` |
| Can I adopt a directory that already exists? | `project_survey` → `project_adopt`, three modes, nothing moved without a decision | `docs/ADOPTION-MODEL.md` |
| What are the limits? | journal verification is O(n); the chain is tamper-evident, not a signature | README “Honest limits” |
| What changed between versions? | CHANGELOG plus per-release notes | `docs/CHANGELOG.md`, `docs/releases/` |
| What licence? | MIT | `LICENSE` |
| How do I remove it? | `dsh plugin remove`; project state stays | README |

## Gaps that remain

1. **Not distributed.** No npm entry, no tarball attached to a release. Consequence:
   installing needs a clone. Fix: publish the package or attach
   `npm pack` output to the release (needs a token).
2. **No `SECURITY.md`.** The guard is a policy layer inside DSH, not a sandbox
   against a determined user; that sentence belongs in a file a stranger can find.
3. **No issue template or contributing note.** A report without the version, the
   failing command and the log costs a round trip.
4. **M12 deferred.** `notebook_verify` reads the journal linearly: ~1.3 s and
   ~1 GB RSS at 100 000 records. Documented, not fixed.
5. **Windows is untested.** Paths go through `node:path`, but a few messages and
   the scanner assume POSIX.
6. **DSH 0.3 is untested.** `engines.dsh` pins `<0.3.0`; the Cordis patch needs a
   fresh run when that changes.

## Verified here, and not

Verified: the full suite locally; the CI file parses and its steps are right; the
icon renders at 48 and 192 px; the About fields are live on GitHub (read back
through the API); the release script refuses to invent a tag and skips cleanly.

Not verified: a machine with no DSH; a Windows checkout; a DSH 0.3 host; an
install from a registry package, because there is none.

## What changed in this pass

- `icon.svg` — cap, magnifier and notebook, primitives only.
- `.github/workflows/test.yml` — CI: Node 22, `matplotlib` for the figure suite.
- `package.json` — `repository`, `author`, `homepage`, `bugs`, `engines.node`,
  and the `scripts` directory added to `files`.
- `README.md` — real install commands, requirements, CI badge, “First five
  minutes”.
- `docs/releases/v0.8.2.md` — release notes used to create the GitHub release.
- `scripts/github-metadata.sh` — sets description, homepage, topics and releases;
  with no token it prints what to paste instead of failing.
- English throughout, except the localisation layer and data aliases (locale
  files, the client's `ru` dictionary, bilingual unit/letter tables, the guard's
  bilingual confirmation prompt, the `экспорт` alias and the Russian folder-name
  matchers in the survey packs).

## Bottom line

For a colleague with DSH installed: hand them the repository URL and the
“First five minutes” section — that works today. Before publishing it to
strangers, add a package or tarball, a `SECURITY.md` and an issue template; the
code itself is tested, the distribution is not.
