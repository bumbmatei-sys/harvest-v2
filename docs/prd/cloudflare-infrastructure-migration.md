# Harvest V2 — Cloudflare Infrastructure Migration PRD

**Status:** Draft — founder-approved direction, implementation and production cutover not yet authorized  
**Date:** 20 November 2026  
**Baseline:** main at `76b0cb90a1b500f1cc1442cdb298b8d1ec07fc2c`; detailed audit at `7f750c544d786f088bebbc7a723706b623e3e7f0`  
**Owner:** Harvest infrastructure / engineering  
**Scope:** Infrastructure migration, independent from product feature delivery and Professional V1 launch scope.

## 1. Decision and objectives

Cloudflare is the intended long-term infrastructure platform for Harvest. Move web application hosting, infrastructure scheduling, background execution, edge services and eligible ancillary services onto Cloudflare. **Retain Neon PostgreSQL as the primary database, Drizzle ORM, Next.js application code, Better Auth, existing Studio Admin/shadcn UI and tenant-security model.** No PostgreSQL-to-SQLite conversion or D1 adoption for core data. Reason (recorded 20 Nov): D1 is SQLite, so it has no row-level security, no roles or SECURITY DEFINER functions, no FORCE RLS and none of the Postgres features the 68+ migrations and the tenant-isolation tests depend on; moving would be a rewrite of the data layer and the security model, with a smaller per-database size limit, not a hosting change.

Target: predictable low hosting costs, fewer infrastructure vendors, globally served application, durable jobs and a straightforward deployment/rollback process. Preserve existing user functionality, data, visual design, tenant membership permissions, data retention policies and feature activation gates. Do not expand Professional V1 functionality merely because a Cloudflare product exists.

The target is not a literal elimination of every external API. Neon, GitHub, Zernio, Dodo Payments, separately approved commerce/donation providers, connected Google/Zoom accounts and selected AI model providers remain external as needed. No migration of those service contracts is implied.

## 2. Migration boundary and architecture

| Area | Current / baseline | Target | Decision |
|---|---|---|---|
| Application hosting | Next.js Node runtime / Vercel-oriented preview | Cloudflare Workers + Static Assets using validated Next.js compatibility layer | Migrate |
| DB | Neon PostgreSQL, Drizzle | Existing Neon PostgreSQL and schema | Retain |
| DB client | Global Drizzle instance, Neon WebSocket/pg pool | Request-scoped pg/Drizzle via cache-disabled Hyperdrive, separate roles | Adapt; validate direct Neon request-scoped fallback |
| Object storage | Private Cloudflare R2, S3 adapter | Existing R2 and signed upload/download flow | Retain; binding optional after parity test |
| Authentication | Better Auth + email OTP + database-backed rate limits | Same auth, Cloudflare environment and trusted proxy config | Adapt |
| Durable jobs | PostgreSQL jobs/outbox plus operator CLI | PostgreSQL remains authoritative; Cloudflare Cron + Queues consumers | Migrate execution |
| Cron / retention | Operator CLIs and gated scripts | Cloudflare Cron Triggers / bounded scheduled jobs | Migrate execution, no automatic activation |
| Workflow automation | Future feature | Cloudflare Workflows where durable multi-step execution is justified | Future; no new product scope |
| Email delivery | Resend SDK / OTP | Cloudflare Email Service only after capability, delivery and security parity | Conditional migration; retain Resend fallback |
| AI | Future assistant, provider-neutral plan | Vercel AI SDK on Workers, Cloudflare AI Gateway (optional Workers AI/Agents SDK) | Future; no Vercel hosting dependency |
| Outbound CRM webhooks | Node HTTP/DNS pinned transport | Validated Workers-equivalent secure transport or isolated Cloudflare Container | High-risk adaptation |
| DNS/CDN/security | Existing domain/edge config | Cloudflare DNS, TLS, WAF, managed rules and appropriate limits | Migrate/retain existing as applicable |
| CI/CD | GitHub + GitHub Actions | Existing exact-head review, protected release workflow, Cloudflare deployment target | Retain |
| Website Builder | Future feature | Workers Static Assets; Cloudflare for SaaS for customer domain onboarding when separately approved | Future |
| Video | Approved BYO Google Meet and Zoom Meetings direction | Same provider APIs; no hosted video media infrastructure | Retain |

Architecture: browser -> Cloudflare DNS/TLS/CDN/WAF -> Harvest web Worker -> Neon via Hyperdrive (app role), R2, authorized external APIs. Separately, Cron triggers and Queues -> background Worker -> Neon via dedicated role(s) + approved integrations. Use a separate isolated webhook transport if needed; do not attach migration-owner credentials to any runtime. Static assets are served directly when possible; authenticated content bypasses shared caches.

## 3. Repository-specific findings

The audited repository contains 192 API route files; the earlier pinned audit counted 117 PostgreSQL table declarations and 68 migrations (main now has more: 0069 onward are in open PRs and later). Counts are snapshots, not migration requirements. Review changed code on the current implementation branch before each slice.

- `package.json`: Next.js 16, React 19, Better Auth, pg, Neon serverless, Drizzle, AWS SDK S3, Resend and next-intl; Node >=22; existing npm/Node build and tests.
- `next.config.ts`: next-intl configuration plus QA OTP and test mailer build aliases, including webpack-specific behavior.
- `src/proxy.ts`: route matching, sanitized workspace header, private/no-store and no-referrer headers; preserve exactly.
- `src/db/client.ts`, `src/db/pool.ts`, `src/server/auth-instance.ts`: global cached database/auth instance and Node WebSocket constructor. Worker requests cannot rely on sharing request-bound IO objects. Rework resource lifetimes.
- `src/server/tenancy.ts`: verified membership, transaction-local app.user_id/app.tenant_id and row locks. These are critical invariants, not optional optimization.
- `src/server/qa-sign-in-gate.ts`: VERCEL_ENV and VERCEL_TARGET_ENV gates, plus database allowlist. Replace with explicit provider-neutral environment policy without weakening fail-closed production behavior. Review all other Vercel assumptions.
- `src/server/storage/s3.ts`, `src/server/storage/s3-connection.ts`: private signed direct uploads, conditional writes, streamed hash/type/size verification, 10 MiB current generic file limit, short-lived signed downloads. Preserve guarantees.
- `docs/setup/jobs.md`, `src/server/jobs/`, `scripts/drain-jobs.ts`: transactional outbox and leased/idempotent jobs, authorized operator dispatch.
- `scripts/run-social-publisher.ts`: test-only fake provider and session-level PostgreSQL advisory lock; Hyperdrive transaction pooling does not support that lock. Redesign before enabling production workers.
- `src/server/webhooks/destination.ts`: DNS lookup, IP blocking and pinned HTTPS connection with TLS hostname validation; critical SSRF/DNS rebinding protection.
- `docs/setup/worker-role.md`: restricted worker-only functions; do not grant elevated privileges or share app/owner credentials.
- `docs/setup/production-migrations.md`, `.github/workflows/ci.yml`: production migration and deployment authorization remain separate from PR test jobs. Do not bypass CI controls.

No Cloudflare runtime build, performance test, DNS cutover or paid provisioning was performed during the research. The migration is feasible in principle, not certified.

## 4. Compatibility gate: Workers, vinext and alternatives

Use Cloudflare Workers rather than a static-only Pages deployment. First investigate the currently recommended vinext path; it reimplements Next.js APIs on Vite, rather than reproducing the stock Next.js server exactly. Evaluate OpenNext as a fallback against the real feature set. A compatible build is a gate, not an assumption. Preserve existing Next.js local development and rollback path.

1. Inventory runtime imports, Node compatibility, native binaries, dynamic evaluation, filesystem use, stream handling, image handling, Next.js API surface, Server Actions, route handlers, proxy matcher, next-intl, PWA generation and request caching.
2. Use the documented Cloudflare CLI/config path supported by the selected adapter; do not introduce competing deployment configurations. Pin versions and compatibility date; set nodejs_compat only as required.
3. Build and run in actual Workers runtime, not only next dev or Node test environment. Record compressed/uncompressed bundle size, startup time, memory, CPU, subrequests and response behavior against published plan limits. Compare adapter support and test results. If Workers cannot safely support a component, split it into an isolated Worker/Container instead of weakening behavior; if core app is incompatible, retain current host until resolved.
4. Preserve build aliases for test-only OTP/mailer behavior or replace with equivalent audited mechanism. No test-only module or secret in production. Verify build-time and runtime environment variable resolution.
5. Use separate staging and production Worker resources, bindings, secrets, domains and isolated Neon branches. Preview builds must never point to production data.

## 5. Database and tenant isolation

Neon remains authoritative. Prefer node-postgres with Hyperdrive, Drizzle and a request-local database/auth lifecycle; do not reuse request-bound global pools across Worker requests. Verify cleanup, concurrent requests and connection timeouts. Direct request-local Neon serverless WebSocket transport is an allowed compatibility fallback, only after equivalent runtime testing.

- Separate Hyperdrive configurations/credentials per environment and role; disable query caching for authenticated data and permission-sensitive reads, including initially all app/worker queries. Never cache tenant/user-dependent responses in shared KV, edge or DB caches.
- Preserve transaction boundaries for set_config(..., true), membership locks, writes, audit and outbox. Never convert interactive transactions to isolated HTTP statements or session-wide SET. All tenant IDs come from verified server context.
- Use least privilege: harvest_app and harvest_worker roles with no superuser/BYPASSRLS; retain migration owner only within trusted manual CI. No owner creds in web or worker bindings.
- Session advisory locks are not supported by Hyperdrive. Replace with bounded, crash-recoverable database leases/fencing or a provably equivalent safe coordination mechanism. Transaction advisory locks alone cannot protect external effects across committed transactions. Keep network calls outside unnecessary DB transactions.
- All existing PostgreSQL migrations, constraints, functions, indexes and RLS rules remain. No wholesale schema rewrite. Narrow migrations only where separately reviewed for compatibility.
- Test concurrent tenants, recycled connections, read-after-write, revoked membership, rolled-back transactions, role denial, auth session expiry and queue claims against real Neon via Hyperdrive.

## 6. Background jobs, Cron and Queues

Retain PostgreSQL jobs/outbox as the source of truth (transactional creation, idempotency, scheduled_for, retries, DLQ/replay, audit). Queue messages are wake-up/dispatch hints, not a second canonical state machine.

- Extract reusable bounded job functions from command-line wrappers; Cloudflare scheduled and queue handlers call these functions, preserving role guards. Keep local/test CLI paths for debug/CI.
- Cron periodically discovers due work and triggers bounded batches. Use Queues for fan-out, backpressure and at-least-once delivery; acknowledge only after durable completion. Handle duplicate messages, partial batches, crash after side effect, failed producer, stale leases, retries and delayed jobs. Reconciliation catches committed outbox jobs if a Queue send fails.
- Do not trust a tenant/user ID from a Queue item as authorization. Use narrow worker grants/functions, validate persisted job identity, and preserve tenant checks. User-asserted CLI identities are not service authentication.
- Social posting: retain test-mode policy, Zernio adapter and existing enablement gate. Require deterministic provider idempotency where offered and reconciliation of uncertain external outcomes; never blindly retry an ambiguous post.
- Retention, community email, follow-ups and other scheduled features remain disabled unless separately approved. No automatic real messages/posting/erasure from staging.
- Use Workflows only for future independent durable multi-step jobs that outlive a bounded invocation. Keep workflow logic optional and subject to approved feature PRDs.
- Operational health: queue backlog, age of oldest job, failed/replayed jobs, stale leases, scheduler heartbeat, external provider errors, redacted structured logs. Define alerts and manual recovery runbook.

## 7. Outbound webhook security

This is a release blocker if it cannot be demonstrated safe. Current transport explicitly resolves all A/AAAA addresses, rejects reserved/private endpoints, pins connection to the validated public IP while preserving TLS SNI/hostname verification, rejects redirects and bounds response/time.

- Check actual Cloudflare Node compatibility for dns, https, net.BlockList and custom lookup callbacks. A successful compilation or ordinary fetch is insufficient.
- Preserve all of those properties and signed webhook delivery, response bounds and retries. Add tests for private/loopback/link-local/mapped IPv6, DNS rebinding, redirects, timeouts, TLS mismatch and provider retry.
- If a safe Worker implementation cannot be proven, run the existing Node transport in a dedicated Cloudflare Container (if eligible), authenticated service-to-service only, with egress restrictions, no public arbitrary proxy route, no database owner credentials, bounded resources and cost. Otherwise keep existing isolated transport until resolved.
- Do not enable outbound deliveries before security review and explicit activation. Inbound provider signature validation, replay protection and redacted logging must remain intact.

## 8. Auth, email, storage and privacy

### Auth and environments
Use distinct explicit deployment environment configuration (local / preview / staging / production), verified against resource identity and DB allowlists. Production denies QA bypass regardless of omitted/misconfigured environment values, forbids test credentials and fails closed on invalid settings. Preserve OTP rate limits, database session behavior, cookie flags/domain, trusted request origin, login throttling and audit. Configure trusted proxy/IP headers for Cloudflare and test spoofed headers.

### Email
Cloudflare Email Service is a migration candidate, not presumed feature-equivalent to Resend. Confirm account/region availability, domain authentication (SPF/DKIM/DMARC), sending limits, bounce/suppression handling, signed delivery webhooks, sender identity, API functionality, reliability and opt-out handling for eligible newsletter/marketing traffic. Validate OTP synchronous delivery/error handling under the current auth policy. Implement provider interface with Resend fallback; do not change sender DNS or send real emails without approval. Keep external newsletter/marketing product scope separate, and retain Resend if Cloudflare lacks required functionality or deliverability.

### R2 and caching
Keep existing private buckets, scoped credentials, CORS, conditional upload protection, checksums, MIME validation, deletion controls and presigned URL expiry. Native R2 bindings may optimize server-side access only if security and semantics remain equivalent; retain S3 presigning if needed. Test the actual Worker stream path and memory under concurrent file verification; keep the current direct-to-R2 upload model rather than buffering large uploads in a Worker. No shared CDN caching of signed URLs, private API results, contact data or tenant-scoped SSR HTML. Public caching requires explicit cache-key and invalidation policy. Separate environment buckets.

### AI
Keep the planned assistant as Vercel AI SDK-compatible TypeScript on Workers. Cloudflare AI Gateway is optional for routing, metrics and budget control. No Vercel-specific OIDC dependency; explicitly configure portable model providers. Validate streaming and aborts in Workers, permission-scoped tools, tenant context, prompt-injection handling and approvals for write actions. Do not log sensitive church, member, pastoral, payment or donor data by default; review gateway payload logging, provider retention and data processing terms. Workers AI, Agents SDK and Vectorize are optional future choices, not mandatory replacements for Neon or pgvector. No AI implementation, inference activation or paid API use in this migration PRD.

## 9. Delivery slices and acceptance criteria

| Slice | Deliverable | Exit criterion |
|---|---|---|
| CF-01 | Compatibility spike: selected adapter, local Worker-runtime build, staging design, dependency audit | Build/runtime evidence; proxy, next-intl, rendering and route smoke tests; measured platform limits; no real side effects |
| CF-02 | Database runtime abstraction and Hyperdrive | Real Neon staging RLS and cross-tenant/concurrency tests; transaction semantics and credential isolation proven |
| CF-03 | Auth/environment/secrets/R2 | OTP, cookies, preview isolation, fail-closed prod gates, file upload/download verification and cache safety |
| CF-04 | Cron, Queues, worker role, job leases, retention and social test-mode execution | Dedupe, retries, crash recovery and scope tests; no enabled production schedules |
| CF-05 | Secure outbound/inbound webhooks | SSRF, DNS rebinding, signatures, TLS, replay and failure-mode verification on actual target runtime; container fallback if necessary |
| CF-06 | Optional email-provider parity and AI gateway readiness | Cloudflare email capability/delivery comparison; explicit fallback, cost and privacy review; no new product scope |
| CF-07 | CI/CD, staging and load testing, operational runbooks | Exact-head CI, staging browser tests, monitored load and rollback rehearsal; manual release approval |
| CF-08 | Authorized production cutover | Signed release approval, credentials isolated, DB backup/restore readiness, DNS/provider callback checks, monitoring, explicit job activation decision |

Indicative engineering estimate: 2–4 weeks of focused AI-assisted development and review if core compatibility spike succeeds. Basic build may take 2–3 engineering days; production readiness is not the same as building. Significant adapter, auth, security, email or container blockers can extend the estimate. These are planning estimates for engineers, not commitments or background work.

### Required release evidence
- Existing npm lint, typecheck, unit tests, RLS tests, Neon migration review and existing Playwright/PWA suites pass for exact PR head.
- Cloudflare runtime integration tests (not just Node mocks) and isolated staging smoke tests cover core CRM, campaigns, communities, jobs, social, files, OTP and available integrations.
- No unauthorized read/write across tenants or public cache leak; no cross-role credential use. Existing audit/consent guarantees remain.
- Measured p50/p95 latency and CPU, memory/startup, error rates, connection saturation, queue throughput and resource limits compared against baseline. Define pass thresholds after initial measurement, not invented performance promises.
- Security review approves SSRF transport, secrets handling, auth and background-worker isolation. Verify provider reconnect/callback URLs and signature validation.
- Deploy and rollback rehearsal on staging; production settings and spend checked before cutover.

## 10. Cost planning (USD/month)

Published Workers Paid model: $5/account minimum; 10M dynamic requests and 30M CPU-ms included; additional requests $0.30/M and CPU $0.02/M ms. Hyperdrive included on eligible Workers paid plan within documented limits. R2 Standard: 10 GB-month included; $0.015/GB-month thereafter; operation allowances and overages separate, internet egress free. Queues: 1M operations included; $0.40/M afterward; typical successful message <64 KiB uses write/read/delete (3 operations), retries cost extra. Email: 3,000 outgoing emails included on paid plan then $0.35/1,000 under published rate, subject to plan/availability. Verify all pricing and account-specific limits before activating or committing spend.

| Monthly workload assumption | Early | Growing | Established |
|---|---:|---:|---:|
| Dynamic requests | 0.5M | 5M | 25M |
| Mean Worker CPU per request | 20ms | 20ms | 20ms |
| R2 GB-month | 20 | 100 | 1,000 |
| Successful queue messages | 0.1M | 1M | 5M |
| Workers estimate | $5.00 | $6.40 | $18.90 |
| R2 storage estimate | $0.15 | $1.35 | $14.85 |
| Queues estimate | $0.00 | $0.80 | $5.60 |
| **Cloudflare subtotal** | **$5.15** | **$8.55** | **$39.35** |
| Illustrative Neon Launch plan (CU-hours: 100/300/1000; GB: 1/5/20) | $10.95 | $33.55 | $113.00 |
| **Illustrative total** | **$16.10** | **$42.10** | **$152.35** |

Neon estimate uses planning inputs $0.106/CU-hour + $0.35/GB-month; current account plan, transfer, branch and storage-history costs must be checked. Eligible free Neon usage could allow initial core infrastructure at approximately $5/month. Estimates exclude extra background Worker CPU/requests not already counted, R2 operation overages, retries, paid WAF/observability, container fallback, email overage, domain fees, AI inference, Zernio, payment fees, and other services. These examples are not measured production usage or guaranteed invoices. Do not extrapolate customer count directly from HTTP requests.

Maintenance target: managed infrastructure, no independently maintained VM for the normal application; isolated container only if necessary for compatibility. Recurring work: monthly usage review, dependency/adapter upgrade checks, credential rotation, backup checks and queue/health review. Compare actual cost against present hosting rather than assuming a 75% reduction in total spend. Add monitoring for CPU, request counts, retries and expensive optional services; use bounded batches/rate limits and application-level budgets, not assume Cloudflare billing alerts enforce hard spending caps.

## 11. Deployment and rollback

- Keep GitHub and GitHub Actions as release source of truth; retain exact-head manual reviews, trusted main-only migration workflow and restricted contexts. Never execute untrusted PR code with deployment or database-owner credentials. No auto-deployment from unreviewed branches.
- Create distinct least-privilege staging/production deployment credentials and Cloudflare bindings. Use secrets management, do not expose credentials in logs or PRs. Disallow unsafe public preview access to production.
- Prepare staging from isolated Neon branch; stage R2, mock providers and test identity. Run smoke and security tests. Production change requires exact approved commit and environment, tested rollback steps and explicit activation checklist.
- Before cutover, record DNS/current configuration, provider webhook/OAuth callback registrations, origin URL, deployment/version, health baselines and Neon restore point. Use backwards-compatible DB changes; document migration dependencies. Existing production migration runbook applies.
- Keep prior Vercel-compatible build/origin available during transition; do not cancel hosting before stability sign-off. If no live origin exists, maintain the existing build as reference and establish last-known-good Cloudflare staging version.
- Pause new side-effect schedulers during change, drain/reconcile existing workers, and ensure a single active dispatcher per workload. Never run both old/new schedules indiscriminately. Verify idempotency and provider deliveries.
- Cut over approved domain/routing, verify TLS, cookies, redirects, CORS, webhooks, health and core user journeys. Canary/stateless rollback where practical. Monitor errors, latency, OTP delivery, queue backlog, DB and costs.
- Rollback triggers: tenant isolation failure, auth bypass, serious webhook security issue, unacceptable error/latency increase, duplicate side effects or failed data integrity checks. Disable failing workers safely, preserve queue/job records, revert to last known-good deployment/origin and routing, reconcile side effects, restore callbacks as necessary. Do not blindly restore DB snapshot over newer writes; assess data loss and get approval for recovery. Rehearse rollback in staging first.

## 12. Unresolved decisions / gates

- vinext vs OpenNext compatibility and maintenance burden for actual Harvest code.
- Whether safe Worker transport is possible for DNS-pinned CRM webhooks or a separate Cloudflare Container is required, including its cost and availability.
- Hyperdrive real Neon behavior with existing RLS, transactions and roles; request-scoped direct Neon fallback.
- Cloudflare Email Service eligibility, OTP deliverability, events/suppression, sending reputation and feature parity with Resend; no replacement until approved.
- Cloudflare resources limits and actual workload billing from staging.
- Production migration job/role readiness, approval boundaries and whether any future rollout order needs a separate product decision.
- Website Builder, Agents SDK, AI Gateway, Workflows, additional data services and paid security are optional future scope, not prerequisites for moving the existing application.

## 13. References

Repository: [package.json](https://github.com/bumbmatei-sys/harvest-v2/blob/7f750c544d786f088bebbc7a723706b623e3e7f0/package.json), [architecture](https://github.com/bumbmatei-sys/harvest-v2/blob/7f750c544d786f088bebbc7a723706b623e3e7f0/docs/architecture.md), [job setup](https://github.com/bumbmatei-sys/harvest-v2/blob/7f750c544d786f088bebbc7a723706b623e3e7f0/docs/setup/jobs.md), [worker role](https://github.com/bumbmatei-sys/harvest-v2/blob/7f750c544d786f088bebbc7a723706b623e3e7f0/docs/setup/worker-role.md).

Official documentation (confirm current values during implementation):
- [Cloudflare Next.js on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Vercel-to-Workers migration with vinext](https://developers.cloudflare.com/workers/static-assets/migration-guides/vercel-to-workers/nextjs/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Hyperdrive connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/), [supported features](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/), [query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)
- [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Workflows](https://developers.cloudflare.com/workflows/)
- [Node HTTP compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/), [Containers](https://developers.cloudflare.com/containers/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/), [AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- [Neon pricing](https://neon.com/pricing), [Vercel AI SDK](https://ai-sdk.dev/docs)

**Authorization:** this draft documents the agreed direction. It does not itself authorize implementation, production credential creation, paid resource provisioning, merge, deployment, live email/social publishing, or data deletion.
