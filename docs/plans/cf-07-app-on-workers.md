# CF-07a · The whole app on Workers

Status 26 Nov 2026: **local workerd check passes**. Nothing is deployed, provisioned or activated. Hosting cutover stays **no-go** (CF-08 needs separate founder approval).

## What this slice adds

- `src/worker/app.ts`: one Worker for the whole app. The explicit buffered API (`src/worker/buffered-api.ts`, tested in CF-03) keeps its entry. Every other request goes to the OpenNext handler inside the request-scoped database and auth context, which now stays open until the response body has been fully read, errors or is cancelled (`holdUntilDone`). A streamed page never reaches a closed connection or another request's handle. Pages are `private, no-store` unless they explicitly say `public`.
- `src/lib/shared-scope.ts`: on Workers the entry and the OpenNext-bundled app each carry their own copy of a module, so a module-level `AsyncLocalStorage` differed between them and pages never saw the entry's scope (they failed closed with `DATABASE_REQUEST_SCOPE_REQUIRED`, the CF-02 guard). The request database, transaction, auth and worker-settings scopes now live once on `globalThis` under registered symbols. In Node there is one bundle and nothing changes.
- `scripts/cf-patch-opennext.mjs`: OpenNext 1.20.18 (`@opennextjs/aws` 4.2.0) bundles its edge converter's `import cookie from "cookie"` without Node's CommonJS interop. cookie 1.x marks itself `__esModule` without a default export, so `cookie.default.parse` was `undefined` and **every request with a Cookie header threw before reaching the app**. This is very likely also what CF-01 saw as 200 / 500 / 401. The script patches exactly that call after the build and fails if the output no longer matches, so an upgrade cannot silently drop or double the fix. Re-check on each OpenNext upgrade (1.20.19 was released on 25 Nov and is not yet evaluated).
- `cloudflare/`: the Worker entry, the OpenNext config template, a local Wrangler config (aliases `resend` to the test mailbox and `server-only` to an empty module, since the entry is server code only) and `tests/cf07/` (mailbox stand-in and the local check).

## Local check

```sh
# tooling outside the repo (CF-01 pins): @opennextjs/cloudflare@1.20.18 wrangler@4.166.0 → $T/node_modules
cp cloudflare/open-next.config.ts.in open-next.config.ts
$T/node_modules/.bin/opennextjs-cloudflare build && node scripts/cf-patch-opennext.mjs
$T/node_modules/.bin/wrangler deploy --dry-run --outdir "$OUT" -c cloudflare/wrangler.local.json
SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt CF07_MINIFLARE_MODULE=$T/node_modules/miniflare/dist/src/index.js \
  CF07_SCRIPT=$OUT/app-worker.js CF07_ASSETS=$PWD/.open-next/assets node --import tsx tests/cf07/run-local.ts
```

Result, 3 of 3 runs: the sign-in page renders; OTP sign-in through the buffered API; the signed-out ministries page redirects; **24 rendered ministries pages from two users, interleaved on one isolate, each showed only the viewer's own ministry**; `private, no-store` on every page; a cancelled page body released its connection; no `harvest_app` session left active. Without the shared scopes the signed-in page failed closed; without the cookie patch it failed in the OpenNext converter.

## Measured

- Upload: 42.9 MB, **7.86 MB gzip**. This is above the Workers Free 3 MB limit, so Workers Paid ($5/month, 10 MB compressed limit per published pricing) is needed. Confirm the account plan and current limits before CF-07b.

## Still open (CF-07b and CF-07c)

- Deploy to an isolated staging origin (Neon branch, cache-disabled Hyperdrive, R2, the CF-03 harness) and run the existing browser and PWA suites against it.
- Load profile, observability, deploy and rollback rehearsal, and the runbook. Make the build reproducible in CI (pinned devDependencies or a tooling job) with the patch step.
- Multipart and large uploads, the public download redirect, and the CF-04 Queue/Cron run on real Workers.
- CF-06 (Cloudflare email) is **skipped for launch** (founder, 26 Nov). Resend stays the transactional provider.
