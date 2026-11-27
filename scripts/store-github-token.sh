#!/usr/bin/env bash
# Store a GitHub token in a 600-mode file, so no command line — and therefore no
# shell history — ever contains the secret.
#
#   ./scripts/store-github-token.sh                 # ~/.config/dsh-research-record/gh-token
#   ./scripts/store-github-token.sh <path>          # an explicit location
#
# Paste the token at the prompt: the input is hidden, and what stays in the
# history is this command, not the token. Everything after that reads the file:
#
#   ./scripts/github-metadata.sh                    # reads the same default path
#   GH_TOKEN_FILE=<path> ./scripts/github-metadata.sh
#
# The token is verified against GET /user right away, so a typo or an expired
# token is reported now rather than in the middle of a release.
set -euo pipefail

target="${1:-${XDG_CONFIG_HOME:-$HOME/.config}/dsh-research-record/gh-token}"
umask 077

if [ -e "$target" ]; then
  printf 'refusing: %s already exists (the old token is left untouched).\n' "$target" >&2
  printf 'Remove it first if you mean to replace it: rm -- %s\n' "$target" >&2
  exit 1
fi

mkdir -p "$(dirname "$target")"

cat >&2 <<'EOF'
Create a fine-grained token for this repository:
  GitHub → Settings → Developer settings → Personal access tokens →
  Fine-grained tokens → Generate new token (repository: dsh-research-record)
  Contents: read and write           (publishing releases)
  Administration: read and write     (description and topics — About only)

Then paste it here. The input is hidden and is not echoed anywhere.
EOF

printf 'token: ' >&2
IFS= read -rs token || true
printf '\n' >&2
if [ -z "${token:-}" ]; then
  printf 'nothing read, nothing written\n' >&2
  exit 1
fi

printf '%s' "$token" > "$target"
chmod 600 "$target"
unset token

result="$(TOKEN_FILE="$target" python3 - <<'PY'
import json, os, pathlib, urllib.error, urllib.request

token = pathlib.Path(os.environ['TOKEN_FILE']).read_text().strip()
request = urllib.request.Request(
    'https://api.github.com/user',
    headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json'},
)
try:
    with urllib.request.urlopen(request, timeout=20) as response:
        print('ok', response.status, json.load(response).get('login', ''))
except urllib.error.HTTPError as error:
    print('http', error.code, '')
except Exception as error:  # network, DNS, TLS
    print('net', type(error).__name__, '')
PY
)"

read -r kind code extra <<< "$result"
mode="$(stat -c '%a' "$target")"
printf 'stored: %s (mode %s, %s bytes)\n' "$target" "$mode" "$(stat -c '%s' "$target")"

case "$kind" in
  ok)
    printf 'verified: authenticated as %s\n' "$extra"
    ;;
  http)
    printf 'warning: the file is stored, but GitHub answered HTTP %s for that token.\n' "$code" >&2
    printf 'Check that it has not expired and that it belongs to the account, then retry:\n' >&2
    printf '  rm -- %s && ./scripts/store-github-token.sh\n' "$target" >&2
    exit 1
    ;;
  *)
    printf 'warning: the file is stored, but GitHub could not be reached (%s).\n' "$code" >&2
    printf 'Retry when the network is back: ./scripts/github-metadata.sh\n' >&2
    exit 1
    ;;
esac
