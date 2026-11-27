#!/usr/bin/env bash
# Fill in the GitHub "About" sidebar and publish the releases of this bundle.
#
#   GH_TOKEN=ghp_xxx ./scripts/github-metadata.sh            # About + every release note
#   GH_TOKEN=ghp_xxx ./scripts/github-metadata.sh v0.8.2     # one version
#
# A fine-grained token needs "Administration: read and write" (description and
# topics) and "Contents: read and write" (releases); a classic token needs the
# single "repo" scope. Nothing here is destructive: the description and topics are
# overwritten with the values below, and a release is only created when the tag
# exists and no release for it exists yet. Without a token the script prints the
# same values so they can be pasted into the web interface instead.
set -euo pipefail

OWNER="AstDen"
REPO="dsh-research-record"
DESCRIPTION="Hash-chained research notebook, artifact provenance, a guard that keeps raw data read-only, project scaffolding with hypotheses/runs/analysis/paper, journal-figure checks and a privacy-preserving usage report — as a DeepSeek Harness bundle."
HOMEPAGE="https://github.com/AstDen/dsh-research-record/blob/main/docs/DETAIL.md"
TOPICS=(dsh deepseek-harness research reproducibility provenance lab-notebook plugin matplotlib scientific-computing openfoam research-data-management audit-trail figures)

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

printf 'About (paste as repository description):\n  %s\n\n' "$DESCRIPTION"
printf 'Homepage:\n  %s\n\n' "$HOMEPAGE"
printf 'Topics:\n  %s\n\n' "${TOPICS[*]}"

if [ -z "${GH_TOKEN:-}" ]; then
  cat <<'EOF'
No GH_TOKEN in the environment, so nothing was sent. Two ways forward:

  a) create a fine-grained token on this repository with "Administration: read
     and write" and "Contents: read and write", then run:
       GH_TOKEN=... ./scripts/github-metadata.sh
  b) set the description, homepage and topics by hand (Settings → About, the
     pencil icon) and create each release from docs/releases/<version>.md.

Either way the release notes are already in the repository.
EOF
  exit 0
fi

api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" \
      -H "Authorization: Bearer $GH_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      --data-binary "$body" \
      "https://api.github.com$path"
  else
    curl -sS -X "$method" \
      -H "Authorization: Bearer $GH_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "https://api.github.com$path"
  fi
}

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }

printf 'About: setting description and homepage…\n'
about="{\"description\": $(json_str "$DESCRIPTION"), \"homepage\": $(json_str "$HOMEPAGE")}"
api PATCH "/repos/$OWNER/$REPO" "$about" | python3 -c \
  'import json,sys; d=json.load(sys.stdin); print("  ", d.get("full_name"), "→", (d.get("description") or "")[:60], "…", "| homepage:", d.get("homepage"))'

printf 'About: setting topics…\n'
names="$(printf '"%s",' "${TOPICS[@]}")"
api PUT "/repos/$OWNER/$REPO/topics" "{\"names\": [${names%,}]}" | python3 -c \
  'import json,sys; d=json.load(sys.stdin); print("  ", len(d.get("names") or []), "topics")'

publish() {
  local tag="$1"
  local notes="docs/releases/$tag.md"
  [ -f "$notes" ] || { printf 'skip %s: %s does not exist\n' "$tag" "$notes"; return 0; }

  if [ "$(api GET "/repos/$OWNER/$REPO/releases/tags/$tag" | python3 -c 'import json,sys; print("yes" if "id" in json.load(sys.stdin) else "no")')" = "yes" ]; then
    printf 'skip %s: release already published\n' "$tag"
    return 0
  fi
  if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    printf 'skip %s: tag does not exist locally (git push --tags first)\n' "$tag"
    return 0
  fi

  local title body payload
  title="$(head -1 "$notes" | sed -E 's/^# //')"
  body="$(python3 - "$notes" <<'PY'
import sys
print(open(sys.argv[1], encoding='utf-8').read().split('\n', 1)[1].strip())
PY
)"
  payload="$(python3 -c '
import json, sys
print(json.dumps({"tag_name": sys.argv[1], "name": sys.argv[2], "body": sys.argv[3], "draft": False, "prerelease": False}))
' "$tag" "$title" "$body")"
  api POST "/repos/$OWNER/$REPO/releases" "$payload" | python3 -c \
    'import json,sys; d=json.load(sys.stdin); print("  published:", d.get("html_url") or d.get("message"))'
}

if [ "$#" -gt 0 ]; then
  for tag in "$@"; do publish "$tag"; done
else
  for notes in docs/releases/*.md; do
    publish "$(basename "$notes" .md)"
  done
fi
