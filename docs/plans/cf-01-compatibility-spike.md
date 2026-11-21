# CF-01 · Harvest on local Cloudflare Workers

Experiment date 21 November 2026. Source baseline `5fd8a46697d2b697baca2b6808b8b63393eb303f` (main, PR #175). The November 20 founder decision retains Neon, Drizzle, Better Auth and the existing tenant model. All five HC-02 activation decisions remain **UNAPPROVED**.

**Recommendation: go-with-conditions for CF-02 engineering only.** Carry OpenNext forward as the candidate because it builds the existing validation code and preserves the webpack path. Keep vinext as the alternative. Both adapters reproduced the same authentication failure in a reused isolate. Retain the tested static asset setting for offline navigation. Keep hosting on Node pending a request-scoped DB/auth implementation, browser and cache parity, and an independently reviewed isolated webhook transport. Retest these exact configurations after upgrades. The OpenNext build itself warns that Node middleware support is experimental.

## Adapter results

| Observation | vinext 1.4.6 | OpenNext 1.20.18 |
|---|---:|---:|
| Build of Harvest with diagnostic routes and original source | Failed client-reference analysis of src/lib/social/auto-dm.ts. Vite's CommonJS plugin mistook the local require helper for a dynamic import. | Passed. Next compiled all routes, typechecked and generated 26 static entries with the fixtures. |
| Local build after spike adjustments | Passed after renaming the local helper. Warning about partial webpack configuration support and inability to classify some dynamic routes. | Passed without editing existing app source. Upstream middleware-support warning applies to src/proxy.ts. |
| Local upload, uncompressed / gzip | 7,596.70 / 1,873.40 KiB | 25,318.50 / 4,852.44 KiB |
| Share of the 65,536 KiB bundle limit | 11.6% | 38.6% |
| Local Wrangler harness listen / first full sign-in response, ms | 8,934 / 1,574 | 15,426 / 842 |
| Separate inspector run, first full sign-in response, ms | 1,466 | 2,416 |
| Next 50 sequential sign-in requests, p50 / p95 wall ms | 93 / 170 | 70 / 168 |
| Inspector JS heap used before / after 51 sign-ins, bytes | 3,888,152 / 34,649,760 | 4,387,784 / 56,697,116 |
| Backing storage after 51 sign-ins, bytes | 15,378,473 | 38,223,571 |
| CPU ticks across the two local workerd processes for 50 QA-helper GETs, 100 ticks/s | 44 ticks, 8.8 ms/request average | 49 ticks, 9.8 ms/request average |
| Workerd process RSS after that batch, KiB per process | 88,360 and 230,972 | 88,308 and 434,300 |
| Subrequest observations | 0 inspector HTTP request events in 51 anonymous sign-ins. 1 fake mail POST on OTP issuance. | 0 inspector HTTP request events in 51 anonymous sign-ins. 1 fake mail POST on OTP issuance. |

The bundle limit on both Free and Paid is 64 MiB **uncompressed**. Gzip size is informational. Startup validation concerns one second of top-level initialization. Harness boot and first-response wall time include other work. Inspector heap and backing storage are snapshots. The 128 MB isolate limit includes other allocations, and process RSS includes runtime overhead. CPU includes the local routing process. These observations cannot establish headroom against platform billing CPU (Free 10 ms, Paid up to five minutes), subrequest quotas (50 / 10,000), or the startup limit. Subrequest counts for DB sockets, internal bindings and cache calls remain unverified. Tests ran on a shared two-CPU-quota host with overlapping build work. No cost extrapolation. The QA batch returned 50/50 expected 404s per adapter. The inspector run returned 51/51 sign-in 200s per adapter. Browser hydration requests for chunks are outside those server-side subrequest observations.

## Workerd smoke results

| Feature | vinext | OpenNext | What was observed |
|---|---|---|---|
| Matcher and sanitised header | Pass | Pass | Forged header removed on invalid workspace segment, replaced with the path UUID on a matched valid segment, and remained intact on the deliberately excluded sibling fixture. |
| next-intl | Pass | Pass | /sign-in with Accept-Language: ro returned 200 with lang=en and translated heading. English is the only configured locale. Authenticated user-locale precedence remains unverified. |
| Static page and PWA assets | Pass for asset reads | Pass for asset reads | /offline.html redirected 307 to /offline, which served English HTML. Service worker, CSS, PNG and manifest returned 200 with appropriate types. |
| Offline navigation in Chromium | Fail by default, pass with asset fix | Fail by default, pass with asset fix | With an active service worker, offline navigation failed with ERR_FAILED. Setting only assets.html_handling to none preserved /offline.html as a nonredirected 200 cache entry. Both adapters then rendered “Offline \| Harvest” on an offline /sign-in navigation. |
| Route handler and production QA endpoint | Pass | Pass | Actual GET /api/qa/otp returned 404 with no-store. All 50 repeated requests per adapter agreed. Header fixtures returned JSON. |
| Security headers | Pass | Pass | The anonymous /account/welcome redirect and gated /connect/claim response both carried private, no-store and no-referrer. |
| Server Action | Pass in Chromium with JS on and off | Pass in Chromium with JS on and off | Sending the rendered action ID to the real action endpoint yielded the expected x-action-redirect (/cf01-action?received=1) on each adapter. The browser followed the form action to /cf01-action?received=1 in all four cases. A manually constructed POST to the page URL returned 405 on vinext and 200 on OpenNext. Use the Chromium result for the user-facing flow. |
| Authenticated workspace route, same isolate, normal pg | **Fail** | **Fail** | The existing email OTP entry point returned 200 and issued one code to a loopback fake. Subsequent sign-in returned 500, set no cookie, and /api/workspaces returned 401. No Hyperdrive. |
| Production module exclusion | Pass for inspected build | Partial | Across 948 vinext upload JS modules and one OpenNext upload JS bundle there were zero matches for the mock mailbox diagnostic, HARVEST_E2E_MAILBOX, @qa.harvest.invalid or the qa1. marker. Of 930 vinext maps and 3,177 source references, one referenced the default hooks and none the two test modules. OpenNext's final map lists 56 prebundled inputs without original app source names. Its runtime 404 and marker absence support exclusion, but module-level provenance needs a webpack module manifest. |

**DB positive control.** With the same embedded DB, app login and fake mailer, resetting only the standalone workerd instance between issuance, verification and the workspace GET produced **200 / 200 / 200** and a session cookie. Same-isolate verification produced **200 / 500 / 401**. This comparison isolates cross-request lifetime as a concrete CF-02 investigation. It does not establish the cause of every possible auth failure.

## Method

The control used the repository scripts and installed lockfile dependencies. Temporary app copies came from `git archive HEAD`, excluding `.env*`. Build and runtime commands received a cleared environment, a temporary home and no provider credentials. The adapter copies included the whole Harvest source and route graph. Diagnostics and adapter configuration live as inert templates under `spikes/cf-01/`. The normal Node build has no dependency on that directory. The local probes used synthetic inputs. There was no deployment or provisioning.

Node 24.22.1, npm 11.9.0, Next 16.4.5, React 19.3.1, pg 8.23.1, TypeScript 6.0.3 and Vitest 5.1.0. Adapter pins were vinext 1.4.6, Vite 8.3.8, @cloudflare/vite-plugin 1.70.1, @vitejs/plugin-rsc 0.5.39, @vitejs/plugin-react 6.3.0, react-server-dom-webpack 19.3.1, @opennextjs/cloudflare 1.20.18 and Wrangler 4.166.0. Adapter configurations use `nodejs_compat` and the 2026-11-19 compatibility date. Runtime smoke tests used Wrangler’s local test harness. Standalone API probes use Miniflare 5.20261117.0-beta, workerd 1.20261117.1 and date 2026-11-17. Wrangler includes workerd 1.20261119.1.

## Inventory on the tested main commit

Paths and lines below refer to the baseline. The audit included the imports in `src`, the CLI boundaries, lockfile and the Next configuration.

| Item | Workers compatibility risk | Evidence (file:line) | Planned mitigation |
|---|---|---|---|
| App Router and route handlers | 239 route.ts files in src/app. Handlers depend on Node compatibility, authenticated context and mutable request headers. | src/app/api/workspaces/route.ts:6; src/app/api/auth/[...all]/route.ts:8 | Exercise the actual HTTP entry points including failure and cookie paths. |
| Server Actions | No quoted use-server directive found in src. An app build alone exercises no action submission. | src/app/sign-in/page.tsx:30; src/app/api/workspaces/route.ts:11 | Submit the isolated action form through each adapter. |
| Proxy and caching | Matcher controls header stripping, replacement and privacy headers. Root layout reads the forwarded value. Tenant pages explicitly force dynamic rendering. | src/proxy.ts:4–13; src/app/layout.tsx:27; src/app/workspaces/page.tsx:15 | Verify matched and excluded paths, private headers and synthetic users across repeated requests. |
| next-intl and fonts | Request uses headers, cookies, optional DB user locale, dynamic JSON import and local font modules. Only en.json is present. | src/i18n/request.ts:10–23; src/app/layout.tsx:1–7; next.config.ts:7 | Validate fallback to English, rendered translation and HTML language in workerd. Preserve precedence as locales expand. |
| Webpack/Turbopack aliases | Dev mailer replacement and local/preview OTP module replacement depend on phase. A Vite build can ignore NormalModuleReplacementPlugin. Production helper returns 404. | next.config.ts:12–28; src/server/auth-otp-hooks.ts:14; src/server/qa-sign-in-gate.ts:5–23 | Inspect emitted modules and probe the production helper. Keep dev-only aliases and allowlists isolated. |
| Database and auth lifetime | Module globals retain Drizzle/pool and auth referencing that DB. Node ws constructor is assigned even on the local pg branch. | src/db/client.ts:6–12; src/db/pool.ts:1–15; src/server/auth-instance.ts:6–9 | Construct request-local DB and auth together, close in finally, and test parallel requests, timeouts and cleanup. |
| Tenant transactions | Membership check, transaction-local identity and shared row lock must use the same transaction. | src/server/tenancy.ts:8–30 | Preserve PostgreSQL and role isolation. Test recycled connections, revocations and rollback in CF-02. |
| Webhook transport | All DNS answers screened. HTTPS custom lookup chooses the approved address while hostname drives TLS. Also requires net.BlockList, bounded time and a 4096-byte response cap. | src/server/webhooks/destination.ts:2–15,65–80,97–115 | Keep dispatch isolated pending proof of every transport property. |
| Social worker | One physical connection owns a session advisory lock across publisher work and commits. | scripts/run-social-publisher.ts:13–29 | Add durable lease/fencing with reconciliation after an ambiguous external effect. Retain fake-only execution. |
| S3/R2 | AWS signing, conditional multipart completion, streaming hash/type checks, bounded reads and aborts depend on SDK runtime selection. | src/server/storage/s3.ts:16–25,39–65,80–89; src/server/storage/s3-connection.ts:11–18,30–39 | Exercise signed headers, conditional writes, ranges, cancellation and memory on local fixtures before isolated staging. |
| Filesystem and native tools | The community test mailbox appends to a local path. PWA generator writes files at build time. Embedded PostgreSQL is a host-side test binary. Sharp is a transitive native image dependency. | src/server/community-email-sender.ts:19–23; scripts/generate-offline.ts:26–27; tests/database.ts:46; package-lock.json:15854 | Keep generator/test binaries on build host. Use static assets, local fake mail and verify the adapter's image path independently. |
| Image/QR handling | Shell requests next/image for a local logo. QR generation calls synchronous Node compression and CRC. | src/components/app-shell.tsx:144; src/server/connect-qr.ts:1 | Exercise optimizer or approved static image path, validate QR output and CPU. |
| PWA/private caches | Service worker precaches four public assets and uses network-first navigation with offline fallback. Manifest is an App Router metadata route. | public/sw.js:2–17; src/app/manifest.ts:5; package.json:21 | Verify asset bodies and MIME types, then run offline browser install and cross-user checks separately. |
| Dynamic evaluation and Node primitives | No direct eval/new Function call found in src. A local function named require was treated as dynamic CommonJS by vinext. Crypto, AsyncLocalStorage and zlib need compatible implementations. | src/lib/social/auto-dm.ts:34–45; src/server/auth-otp-hooks-preview.ts:1; src/server/auth.ts:2; src/server/connect-qr.ts:1 | Check transitive emitted code and startup. The isolated validation-helper rename preserves its checks. |

## Blocker decisions

| Question | Result | Evidence and consequence |
|---|---|---|
| Can the existing DNS-pinned HTTPS sender run unchanged? | **No** | The standalone workerd probe successfully added an IPv4 subnet to BlockList and rejected loopback. The DNS lookup of localhost made two intercepted subrequests and returned ENOTFOUND with the fake responses. HTTPS rejected options.lookup with ERR_OPTION_NOT_IMPLEMENTED before invoking it. The validated address therefore cannot be pinned by this transport. Pinning with SNI/certificate mismatch rejection, IPv6 policy, redirects and bounded response delivery remain unverified on Workers. Do not substitute ordinary fetch. |
| Is the Container fallback feasible? | **Yes, conceptually** | A Linux Node process can host the existing resolver/HTTPS stack. Use an authenticated internal service, restrict egress, preserve name verification and response/time bounds, and keep credentials scoped to the caller's job. Eligibility, egress controls, target TLS behavior, operations and availability need separate verification. No Container was provisioned. |
| Can session advisory locks be retained through transaction pooling? | **No** | scripts/run-social-publisher.ts:18–26 holds a dedicated connection. Hyperdrive's transaction pool does not provide session affinity across commits. A transaction lock alone cannot guard the provider effect. Use bounded DB claims with fencing, idempotent effects and uncertain-outcome reconciliation. Direct local pg tests do not establish Hyperdrive behavior. |
| Can DB/auth instances keep active IO across requests? | **No for the tested global pool** | In one isolate, two independently closed pg pools each queried current_user successfully as harvest_app. The shared pool returned 200 then a workerd cancellation/500 on its second request. In the actual auth handler, issuance returned 200 and the local mailbox received the code. Verification in the same isolate returned 500, yielding no cookie and a 401 from GET /api/workspaces. The scoped query control covers connection lifetime only. |
| Are test-only aliases excluded? | **See adapter evidence** | The production QA helper must be unreachable and the preview implementation and filesystem mailer must be absent from emitted code. An HTTP 404 alone is insufficient. Development and preview alias selection require separate positive tests before adopting an adapter. |

## Spike patches and reproduction

Use disposable archive copies, all commands below from the applicable copy. The branch contains templates only. Copy them to the listed targets in the disposable tree. A Linux host with a UTF-8 locale, Node 24, a C compiler and loopback sockets was used.

1. Start with `git archive 5fd8a466 -- . ':(exclude).env*' | tar -x -C "$copy"`. Install the original lockfile dependencies (the experiment copied the installed baseline). In the vinext copy add the exact adapter packages listed above via `npm install --save-exact --legacy-peer-deps --ignore-scripts --no-audit --no-fund`. The OpenNext copy used the same installed dependency tree. Neither the root manifest nor the lockfile on the branch was edited.
2. In both copies materialize `action-page.tsx.in` at `src/app/cf01-action/page.tsx` and `header-route.ts.in` at both `src/app/workspaces/[tenantId]/cf01-header/route.ts` and `src/app/cf01-header/route.ts`. These synthetic routes expose the forwarded hint and exercise form submission in the copied app only. No existing route is replaced.
3. For vinext copy `vite.config.mjs.in` and `vinext.wrangler.json.in` to `vite.config.mjs` and `wrangler.json`. Run `vinext build` first, then apply `patch -p1 < vinext-validation.patch` and rebuild. The patch renames the locally scoped validation helper named require. Its callers and validation rules are otherwise identical.
4. For OpenNext use `open-next.config.ts.in` and `opennext.wrangler.json.in` as `open-next.config.ts` and `wrangler.json`, with the original validation helper. Run `opennextjs-cloudflare build`. No cache storage, remote service, images binding or deployment credential is configured.
5. Generate the local upload-size report with `wrangler deploy --dry-run -c CONFIG --outdir OUTPUT`. The vinext runtime config is `dist/server/wrangler.json`. For OpenNext use `wrangler.json`. Dry-run exits after local bundling.
6. Compile the local socket guard with `cc -x c -shared -fPIC loopback.c.in -o /tmp/cf01/loopback.so -ldl`. Copy each probe to the root of a disposable app without its .in suffix. Run `node --import tsx smoke.mts CONFIG` with the guard in LD_PRELOAD. It starts embedded PostgreSQL, uses the generated harvest_app login, binds a fake Resend HTTP endpoint on 127.0.0.1 and starts Wrangler's local test harness. It closes the test harness, fake mail listener and DB afterwards. Runtime credentials are generated fixtures. Inherited environment is cleared, LANG/LC_ALL=C.UTF-8, CI=1, NEXT_TELEMETRY_DISABLED=1, WRANGLER_SEND_METRICS=false, CLOUDFLARE_CF_FETCH_ENABLED=false, dead loopback HTTP(S) proxy and NO_PROXY=localhost,127.0.0.1.
7. `node transport.mjs` runs the synthetic HTTPS and BlockList probe with intercepted HTTP egress. `node --import tsx db-probe.mts` bundles the original pg factory and auth/workspace handlers into a separate local Worker, with only a fake mailer module substituted. `--fresh-isolate` resets workerd between authentication steps while retaining the same database. No standalone probe substitutes for an adapter result.

8. For inspector numbers, run Wrangler locally on 127.0.0.1:18787 with inspector port 19229 and the same config. Copy inspect.mjs.in to inspect.mjs beside the installed ws package and run it with Node. For browser checks use local Wrangler on 127.0.0.1:18788 and browser.mjs.in as browser.mjs. Repeat with one isolated config change: copy the runtime Wrangler JSON alongside the original and set `assets.html_handling` to `"none"`. This config-only fix was tested on both adapters without rebuilding Harvest.

## Command log

Exit codes refer to the named process. The observation harnesses print per-request results, so exit 0 can accompany a failed feature. All npm bin commands used installed local packages. Host names, tokens, cookies, OTP values and DB connection strings were excluded from the evidence.

| Command or phase, in order within each experiment | Exit | Outcome |
|---|---:|---|
| git rev-parse HEAD, GitHub main lookup, git switch -c spike/cf-01-workers-compat | 0 | Base matched remote main. |
| npm view vinext and @opennextjs/cloudflare | 1, 1, then 0 | Original sandbox denied registry access. The next attempt could not write the default npm cache. Using public npm with the writable cache returned the listed versions. |
| curl for public framework and limits docs | 22 | HTTP 403 from the environment. Used the published vinext README from npm and Cloudflare’s public documentation search for limits. |
| npm install of pinned tooling in the disposable tree | 0 | No install scripts, audit, deployment or account login. |
| npm run lint / npm run typecheck | 1 then 0 / 0 | tsx initially could not open its Unix IPC socket. Retrying the original lint script with socket access passed eslint with zero warnings and passed source guards. Typecheck passed. |
| npm test | 1, 1, 0 | Initially 1,347 passed, 8 failed under socket restrictions. With local sockets, 1,354 passed, 1 timed out during competing builds. Final unchanged suite passed **1,355/1,355 in 104/104 files**, 85.22 s. |
| npm run build (normal Node control) | 1, 1, 0 | First prebuild hit the tsx IPC restriction. The next concurrent build stopped at typecheck during host memory pressure (one cgroup OOM kill observed, victim unconfirmed). Final unchanged run completed all 24 static entries. |
| npm start -- --hostname 127.0.0.1 --port 18789, curl -fsS /sign-in | ready, 0 | Node served the sign-in heading. Server intentionally stopped after the check. |
| vinext build, before / after validation-helper patch | 1 / 0 | First failure and correction in adapter results. Five Vite stages completed on retry. |
| opennextjs-cloudflare build | 0 | Real webpack build and Worker packaging completed. |
| wrangler deploy --dry-run for vinext / OpenNext | 0 / 0 | Measured uploaded modules separately from static assets and debug maps. |
| node transport.mjs | 1, 1, 0 | First corrected Miniflare v5 option conversion, then captured synchronous HTTPS errors inside the Worker. Final result records the unsupported lookup option and zero callback invocations. |
| node --import tsx db-probe.mts, same isolate / --fresh-isolate | 1 then 0 / 0 | Embedded init with a stripped locale selected SQL_ASCII. UTF-8 host locale allowed existing migrations. The positive control used identical DB contents across fresh isolates. |
| cc -x c -shared -fPIC loopback.c.in -ldl | 0 | Compiled local socket restriction for runtime probes. |
| node --import tsx smoke.mts CONFIG | 0 for both | Compared HTTP responses including real OTP issue, verify and authenticated-style GET. vinext ran twice, second run included action protocol and canonical static URL checks. |
| wrangler dev --local and node inspect.mjs | 13 then 0 for vinext, 0 for OpenNext | Initial Node WebSocket client did not connect. The installed ws client connected over loopback. Retrieved inspector heap usage, request events and response wall time. Servers stopped after measurement. |
| node browser.mjs against each wrangler dev --local instance | 0 for both | Ran two Chromium contexts per adapter. Each completed the Server Action. The default asset configuration failed offline navigation on both. Repeating with html_handling=none also exited 0 on each, and the offline title and cached response URL passed. |
| Production bundle source and marker scans | 0 (scan completed) | Results above cover the local production-mode builds. No preview or QA credentials were supplied. |

## Evidence limits

The exact production startup validation time, isolate peak memory, billed CPU, platform subrequest counters, concurrency limits and load saturation remain unverified. No real Neon, Hyperdrive, R2, external TLS destination, Container, email delivery, social provider or Cloudflare account participated. CF-02 must test role denial, revoked membership and transaction rollback under concurrent tenants. CF-03 must prove that the production artifact excludes test code even when the environment is misconfigured. Confirm image optimization, QR/stream CPU, maximum file sizes, cross-user cache isolation, positive QA/preview alias selection and browser regressions beyond these smoke cases. No hosted staging, CI deployment, rollback rehearsal or release approval was part of this experiment.

## Remaining slices

Single-engineer planning ranges in working days, including implementation and focused verification. These assume an available reviewer, fixture access and a chosen adapter. They exclude waiting for approvals and external provider eligibility.

| Slice | Estimate | Deliverable that drives the estimate |
|---|---:|---|
| CF-02 | 4–8 | Replace DB/auth lifetime, preserve transactions and row locks, verify real Hyperdrive role separation, rollback, concurrency and tenant isolation with caching disabled. |
| CF-03 | 4–7 | Prove trusted origin/IP handling, fail-closed QA policy and alias separation, cookies, signed multipart operations, bounded stream validation and cache safety. |
| CF-04 | 5–9 | Replace session coordination with a durable lease and fencing. Exercise duplicate deliveries, crash recovery and restricted worker role with fake providers. |
| CF-05 | 5–10 | Validate an isolated Node transport or equivalent with controlled DNS/TLS fixtures, signed requests, replay protection and an independent security review. |
| CF-06 | 2–5 | Conditional transactional email parity and AI gateway/privacy design. Real delivery and eligibility are separate dependencies. |
| CF-07 | 4–8 | Exact-head CI, separate staging bindings, browser/PWA checks, load profiles and rollback rehearsal. Local process measurements alone cannot establish platform headroom. |
| CF-08 | 1–3 after approvals | Restore-point and callback verification, controlled routing change and rollback observation. Requires separate authorization. |

For future staging, isolate the Worker, host, secrets, empty private bucket and a Neon test branch. Separate app and worker roles, use cache-disabled Hyperdrive, fake providers and disabled schedulers. Keep owner credentials in the existing trusted migration workflow. Preserve the Node origin as the rollback target. This is a design only.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [September limit change](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/), [Hyperdrive supported features](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/), [Containers](https://developers.cloudflare.com/containers/), [repository PRD](../prd/cloudflare-infrastructure-migration.md).
