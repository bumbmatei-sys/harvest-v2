#!/usr/bin/env bash
# Waits until the deployed site at HARVEST_SMOKE_BASE_URL serves the commit being
# checked (or a later main commit), by reading its /api/version endpoint.
# Usage: scripts/smoke-wait-for-deploy.sh <40-character commit SHA>
# Reads only public data; never prints the bypass secret.
set -euo pipefail
expected="${1:?commit SHA required}"
[[ "$expected" =~ ^[0-9a-f]{40}$ ]] || { echo "Expected a full lowercase commit SHA."; exit 2; }
base="${HARVEST_SMOKE_BASE_URL:?HARVEST_SMOKE_BASE_URL is required}"
base="${base%/}"
timeout="${HARVEST_SMOKE_DEPLOY_TIMEOUT_SECONDS:-1200}"
interval="${HARVEST_SMOKE_POLL_SECONDS:-20}"
bypass="${VERCEL_AUTOMATION_BYPASS_SECRET:-}"
if [ -n "$bypass" ] && ! [[ "$bypass" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "VERCEL_AUTOMATION_BYPASS_SECRET has unexpected characters."; exit 2
fi
# The header goes to curl on stdin, never on its command line.
fetch_version() {
  { if [ -n "$bypass" ]; then printf 'header = "x-vercel-protection-bypass: %s"\n' "$bypass"; fi; } \
    | curl -fsS --max-time 10 --config - "${base}/api/version" 2>/dev/null
}
deadline=$((SECONDS + timeout))
last="none-yet"
while :; do
  live="$(fetch_version \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const c=JSON.parse(s).commit;process.stdout.write(typeof c==="string"&&/^[0-9a-f]{40}$/.test(c)?c:"")}catch{}})' || true)"
  if [ "$live" = "$expected" ]; then echo "The deployed site serves $expected."; exit 0; fi
  if [ -n "$live" ]; then
    # A later merge may already have replaced this release; test that one instead.
    if ! git cat-file -e "${live}^{commit}" 2>/dev/null; then
      git fetch --no-tags --quiet origin main:refs/remotes/origin/main --depth=200 || true
    fi
    if git cat-file -e "${live}^{commit}" 2>/dev/null && git merge-base --is-ancestor "$expected" "$live"; then
      echo "The deployed site already serves a later commit ($live); checking that release."
      exit 0
    fi
    # Documentation-only commits may not trigger a deployment; the live release then has the same app.
    if git cat-file -e "${live}^{commit}" 2>/dev/null && git merge-base --is-ancestor "$live" "$expected" \
      && ! git diff --name-only "$live" "$expected" | grep -Ev '^(docs/|.*\.md$)' >/dev/null; then
      echo "Only documentation changed since the deployed commit ($live); checking that release."
      exit 0
    fi
  fi
  if [ "$live" != "$last" ]; then echo "Deployed commit: ${live:-unknown}. Waiting for $expected..."; last="$live"; fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "The deployed site did not serve $expected within ${timeout}s. Check that the production deployment finished."
    exit 1
  fi
  sleep "$interval"
done
