#!/usr/bin/env bash
# CF-07: build the whole app for Cloudflare Workers. Uses the pinned tools in cloudflare/tooling (never the app's own
# dependencies), links OpenNext so the copied config resolves it, builds, and applies the checked cookie patch.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci --prefix cloudflare/tooling --no-audit --no-fund
mkdir -p node_modules/@opennextjs
ln -sfn ../../cloudflare/tooling/node_modules/@opennextjs/cloudflare node_modules/@opennextjs/cloudflare
cp cloudflare/open-next.config.ts.in open-next.config.ts
NEXT_TELEMETRY_DISABLED=1 cloudflare/tooling/node_modules/.bin/opennextjs-cloudflare build
node scripts/cf-patch-opennext.mjs
