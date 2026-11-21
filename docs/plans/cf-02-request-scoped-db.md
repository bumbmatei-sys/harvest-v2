# CF-02 · Request-scoped database and auth

The founder approved local CF-02 engineering on 21 November 2026. The base is `bfafc6e2c44ee98b7c50fc905ec35f6bc0ef7344` on `main`, including the CF-01 report. Node/Vercel remains the hosting path. All five HC-02 gates are **UNAPPROVED**. [Infrastructure PRD](../prd/cloudflare-infrastructure-migration.md) · [CF-01 findings](cf-01-compatibility-spike.md) · [Founder decision](../decisions/founder-decisions-2026-11.md)

## Database and auth lifecycle

- `withDb(env, async (db, connection) => …, { signal, timeoutMs })` owns the database scope. The second argument is the promise-based pg query interface used by the worker’s existing SQL-function client. Workers call `new Client` on the selected binding and close it on success, failure, abort or deadline. A scope serializes whole Drizzle transactions and standalone queries on that client. Transaction callbacks use their supplied `tx` because the root handle rejects reentry. Escaped request and transaction handles refuse subsequent queries.
- The runtime and role are explicit. Workers supply an `APP_HYPERDRIVE` or `WORKER_HYPERDRIVE` binding according to the role and have no fallback URL. The legacy synchronous accessors accept a current request scope or use the existing Node pool. The Node fallback checks the runtime before using process configuration. The Node scoped factory checks out from a shared pool and releases healthy clients. It discards interrupted checkouts. The Worker deadline defaults to 15 seconds, including connection setup.
- On Node, existing web entry points still use pooled Drizzle and a Better Auth instance on the shared Node pool. Local Postgres still uses pg and the existing Neon URL path still uses the Neon WebSocket pool. Better Auth options, transactions and callbacks remain the existing ones. The Node runtime expects the documented `harvest_app` URL. A migration owner URL is rejected.
- `withWorkerRequest(env, request, handler)` wraps an awaited, buffered application handler. Inside it, existing `getDb()` and `getAuth()` calls resolve to that scope, with one lazily built Better Auth instance. Worker secrets and trusted proxy settings come from explicit bindings. Buffered handlers finish all database work before returning. CF-03 must verify where to put the lifecycle boundary for streamed React responses and the selected Next adapter.
- Both scoped transports check the actual session principal before running application work. They refuse unexpected identities, membership in other roles, elevated flags, and ownership of the current database or public schema, relations or routines. Credentials are separated by role. Use `DATABASE_URL` for the Node app and `WORKER_DATABASE_URL` for the Node worker. Use separate Hyperdrive configurations for app and worker in each environment, each with **all query caching disabled**. The migration owner URL belongs in the trusted migration workflow. No runtime binding uses it.
- `src/server/tenancy.ts` and the migrations are untouched. Membership discovery, transaction-local `app.user_id/app.tenant_id`, the membership row lock and the corresponding read or write still happen in the same PostgreSQL transaction. FORCE RLS and existing grants remain in effect. An interrupted commit can still have an ambiguous outcome. Callers should only replay operations with an appropriate idempotency contract.

CF-01 observed OTP issue/sign-in/workspaces returning 200/500/401 with a reused isolate and 200/200/200 with fresh isolates. The Worker scope removes the shared pool and auth reference from the request path. The standalone local harness is wired to call the same three application handlers with one workerd instance and a service-binding mailbox. The broader adapter findings on middleware, alias exclusion, PWA asset handling, image/QR behavior, R2, and webhook DNS pinning still apply. OpenNext remains the candidate for follow-up adapter work. [CF-01 findings](cf-01-compatibility-spike.md)

## Fake publisher coordination

`HARVEST_SOCIAL_PUBLISHER=test npm run social:publish:test -- --lease` opts into the local, grouped fake publisher path. The existing CLI without `--lease` retains its session advisory lock. The new path commits the existing migration 0069 claim before dispatch and uses a fresh database scope for each subsequent SQL operation. It claims at most one delivery for 300 seconds. The existing `FOR UPDATE SKIP LOCKED` claim and random `lock_token` fence completions by tenant, delivery and token. A recovery claim removes or replaces the token. Once that happens, stale completion returns `stale`. The existing function can accept a completion after the nominal expiry until recovery has invalidated the token.

An expired grouped claim with an unknown provider outcome and no reference becomes `unknown`. A known reference is reconciled by status or a verified provider event. An unknown outcome is held for reconciliation or human review and is never blindly retried. An in-flight external effect cannot be revoked by fencing a later database write. A future real worker needs a provider-level reconciliation and idempotency contract, including what constitutes definitive failure. The optional path rejects a batch containing legacy single-post or non-fake claims inside the claim transaction. The existing function also performs queue-wide recovery, so use an isolated synthetic database with this test mode. There are no changes to the publisher, provider adapters, SQL functions, or schedules. [Migration 0069](../../drizzle/0069_social_publish.sql)

## Local checks

The integration project runs the same eight isolation cases with a shared Node pool and with a new pg client per scope. Additional assertions cover reuse versus fresh physical connections, escaped handles, pool/backend counts, and credential refusal. The fake publisher test covers a lost claim, unchanged `unknown` outcome, rejection of stale completion, and two competing runs with one synthetic publish. No application dependency or lockfile change is needed.

`tests/cf02/run-local.ts` adds the same cases and a repeated real OTP issue, sign-in, and authenticated workspace GET under standalone workerd. It accepts the absolute path to the Miniflare package entry in `CF02_MINIFLARE_MODULE`. Use the CF-01 pins `miniflare@5.20261117.0-beta` and `workerd@1.20261117.1` in a disposable directory. In the following example, `CF02_COPY` is a disposable checkout with the same lockfile dependencies and `CF02_TOOLING` is that disposable tooling directory. Miniflare’s `hyperdrives` values are the equivalent of Wrangler’s local `localConnectionString`. Both point only at automatically generated embedded PostgreSQL fixture credentials. The mock mailbox is an internal service binding.

```sh
cd "$CF02_COPY"
cp spikes/cf-01/loopback.c.in "$CF02_TOOLING/loopback.c"
cc -shared -fPIC "$CF02_TOOLING/loopback.c" -o "$CF02_TOOLING/loopback.so" -ldl
LD_PRELOAD="$CF02_TOOLING/loopback.so" \
  CF02_MINIFLARE_MODULE="$CF02_TOOLING/node_modules/miniflare/dist/src/index.js" \
  LANG=C.UTF-8 LC_ALL=C.UTF-8 CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false \
  node --import tsx tests/cf02/run-local.ts
```

## Verification results

| Check | Result |
| --- | --- |
| `npm run lint` | Passed with zero warnings and source guards passing. |
| `npm run typecheck` | Passed against fresh Next-generated types in a disposable checkout. |
| Full unit project | 1,361 passed in 105 files at the default test timeout after the competing builds and integration run had finished. |
| Full integration project | 978 passed in 115 files against embedded PostgreSQL, preserving the 957 existing cases and adding 21. |
| Focused CF-02 integration | 10 Node scope tests, 10 Workers-style direct pg scope tests and one fake publisher lease test passed. Tests covered tenant isolation under contention, row-lock revocation, rollback and context reset, read-after-write, role denial, connection cleanup, aborts and expiry. |
| Standalone probe bundles, executed under Node against embedded PostgreSQL | Both bundles built offline. The eight isolation probes and the separate concurrent request check passed. With the fake mailbox, the actual OTP issue, sign-in and workspace routes returned 200/200/200 on the Workers-style database path. |
| `npm run build` | Passed in a disposable Node checkout. Next generated 24 static entries. |
| Miniflare/workerd local run | Prepared. The pinned packages were absent from the local installation. An offline install returned `ENOTCACHED`. The Node-hosted probes leave the original workerd regression and workerd socket cleanup unverified. |
| Real Neon through Hyperdrive | Prepared only. Verified that staging skips by default and in CI. |

## Neon staging harness · prepared

Run only in a later, separately authorized staging session. The founder supplies a disposable Neon test branch with synthetic data and the existing migrations through 0073. Apply migrations using the existing trusted process. Supply two distinct **direct** branch-origin URLs for the SQL-created `harvest_app` and `harvest_worker` logins. A Cloudflare account needs two distinct staging Hyperdrive configs targeting that branch and database, each using its corresponding login with query caching disabled. Confirm the branch endpoint, role and cache settings in those configurations. The suite can check role privileges and database name through the bindings, while the branch identity and Hyperdrive cache settings are deployment metadata.

1. Inject `CF02_RUN_STAGING=1`, `CF02_HYPERDRIVE_APP_ID` and `CF02_HYPERDRIVE_WORKER_ID` in a disposable checkout. Run `node --import tsx tests/cf02/prepare-worker.ts`. It prints a temporary directory with an isolated probe bundle and Wrangler config. The config references IDs only and has no production routes or schedules.
2. Start a protected staging preview for that bundle using a Wrangler version that supports remote preview with Hyperdrive, such as `wrangler dev --remote --config "$CF02_PREVIEW/wrangler.json" --ip 127.0.0.1` if supported for the account. Inject a new independent `CF02_PROBE_TOKEN` and `CF02_AUTH_SECRET` into that preview as temporary secrets. Use a restricted preview and the probe token. The remote preview must supply real staging Hyperdrive bindings. Local `localConnectionString` settings would bypass the service and invalidate staging evidence.
3. Inject `CF02_NEON_URL_APP`, `CF02_NEON_URL_WORKER`, the same `CF02_PROBE_TOKEN`, and `CF02_STAGING_ENDPOINT` (the protected HTTPS origin or the Wrangler loopback origin). Run `node --import tsx tests/cf02/run-staging.ts`. The connection URLs are validated in memory. All suite queries go through the probe’s two Hyperdrive bindings. The suite runs the same eight isolation cases and repeats independent requests against the preview. Both scripts skip by default and in CI. The harness creates synthetic users, workspaces and audit rows. Dispose of the temporary preview and test branch at the end.

Keep the origin credentials in a secret manager and inject them directly. The test artifacts contain no origin URLs or credentials. The staged probe only exposes the named test operations and has no sender. Staging is needed to confirm real Hyperdrive role behavior, cache settings, transaction pooling, disconnect behavior, and connection limits. The local Hyperdrive emulator uses direct local sockets and cannot establish those properties. [Hyperdrive features](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/)

## Go or no-go

Continue local engineering and prepare isolated staging. Close the reused-isolate regression on workerd and verify real Neon through cache-disabled Hyperdrive before marking CF-02 complete. Hosting cutover stays **no-go**.

| Slice | Remaining evidence |
| --- | --- |
| CF-03 | Full OpenNext request and streaming lifecycle, trusted origins and IPs, OTP/cookies, production bundle exclusions, QA preview isolation, R2 signatures and bounded streams, cross-user cache tests. |
| CF-04 | Queue/Cron dispositions, recovery and concurrent dispatch under Hyperdrive, duplicate and unknown results, provider reconciliation and dedicated worker role. |
| CF-05 | Independent verification of DNS/IP pinning, TLS, signatures, replay protection, time and byte bounds using the isolated transport. |
| CF-06 | Transactional email and AI gateway parity only if approved, with privacy and cost review. |
| CF-07 | Exact-head CI, staging browser/PWA and load checks, observability and rollback rehearsal. |
| CF-08 | Separate release approval, credential and callback verification, backup/restore, measured cutover and rollback readiness. |
