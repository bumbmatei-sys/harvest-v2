# CF-07a · The whole app on Workers

Status 26 Nov 2026: **local workerd check and hosted staging run pass**. Nothing is deployed, provisioned or activated. Hosting cutover stays **no-go** (CF-08 needs separate founder approval).

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

## Hosted staging run · 26 Nov 2026 (CF-07b)

Founder-authorized disposable resources, all deleted afterwards: a schema-only Neon branch with all **113 migrations through 0114** applied by the owner, a cache-disabled Hyperdrive config for `harvest_app`, two private R2 buckets, the CF-03 harness, and the whole-app Worker deployed with **Wrangler** from `tests/cf07/prepare-staging.ts` (workers.dev opt-in, IDs only; secrets added with `wrangler secret bulk` from a temporary file). The account is now on **Workers Paid** (founder, 26 Nov).

- **0114 applied as intended on Neon:** `pg_db_role_setting` showed `harvest_app {statement_timeout=20s}` and `harvest_worker {statement_timeout=60s}`, so the Neon owner can set them.
- **`tests/cf07/run-staging.ts`, 3 of 3 runs:** sign-in page 200 and `private, no-store`, OTP sign-in through the real edge, the signed-out ministries page redirects, **50 concurrent rendered ministries pages from two users with no cross-user leak**, no edge cache hit, cancelled body. Afterwards the origin showed only idle Hyperdrive pool sessions.
- **Hosted logs:** 204 events, no generated secret. The only failure was one `get-session` request made before the secrets were added.
- **Measured:** upload 7.86 MB gzip; **Worker startup 820 ms**, close to the 1 s startup limit, so keep an eye on bundle growth (CF-07c).
- **Deploy notes:** the OpenNext source maps are about 62 MiB, above the 60 MiB upload limit, so the config sets `upload_source_maps: false`. Static assets were not uploaded in this run (`CF07_STAGING_SKIP_ASSETS=1`): the operator's network proxy rewrites `Authorization`, and the asset upload uses its own session token. A deploy job with its own token (CF-07c) uploads them, and then the manifest and static-file checks run too.

## Still open (CF-07b and CF-07c)

- With static assets (deploy job with its own token): manifest, offline page and the existing browser and PWA suites against staging.
- Load profile (including connection pressure from holding a connection for the whole page transfer, up to the 15 s deadline), observability, deploy and rollback rehearsal, and the runbook. Exact devDependency pins for `@opennextjs/cloudflare` 1.20.18 and `@opennextjs/aws` 4.2.0, and report the cookie interop bug upstream. Make the build reproducible in CI (pinned devDependencies or a tooling job) with the patch step.
- Multipart and large uploads, the public download redirect, and the CF-04 Queue/Cron run on real Workers.
- CF-06 (Cloudflare email) is **skipped for launch** (founder, 26 Nov). Resend stays the transactional provider.
