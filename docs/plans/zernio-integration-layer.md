# Social provider integration layer (server foundation)

Status: engineering plan, 14 Nov 2026. **Foundation only.** No screen, no copy, no live call, no activation. Every gate in "Open decisions" is **UNAPPROVED**; where a default was needed the safest option was taken and is marked.

Provider: Zernio is the API provider only. Nothing in its frontends is reused. Vendor names stay out of user-facing strings; internal code and docs may name it.

## Scope

In: a Harvest-owned, provider-neutral port; an in-memory fake provider; a hard-disabled Zernio adapter; tenant-scoped connection records with sealed credentials; a guarded post queue; signed-webhook intake; a worker that can only run against the fake; permissions, RLS, audit, tests, source guards.

Out (later, each gated): connect/OAuth flow and screens, composer/calendar/inbox UI, inbox cache, reply sending, Auto-DMs, blog distribution, analytics, billing/quota enforcement, webhook endpoint registration, real activation.

## Port (`src/server/social/port.ts`)

Harvest owns every type (`types.ts`); no adapter type crosses the port. `SocialProvider`:

| Group | Methods |
|---|---|
| Accounts | `listAccounts(cred)`, `getAccountHealth(cred, accountRef)` |
| Posts | `publishPost(cred, {idempotencyKey, accountRef, platform, content, media, scheduledFor?})`, `cancelPost(cred, postRef)`, `getPostStatus(cred, postRef)` |
| Inbox (read, live pass-through, never stored) | `listConversations`, `listMessages`, `listComments` |
| Webhooks | `verifyWebhook(rawBody, signature, secrets)`, `parseWebhookEvent(rawBody)` |
| Sending (signature only) | `SocialSender.sendMessage`, `SocialSender.replyToComment` |

Sending lives on a separate `SocialSender` interface. The registry has no way to hand one out (`SOCIAL_SENDING_NOT_AVAILABLE`), the service layer never calls it, and a source guard keeps `sendMessage`/`replyToComment` inside the port and the two adapters. Inbox replies and Auto-DMs are a later feature gated by the consent layer (`mayContact` from HC-DEC1b / PR #81, referenced here in docs only).

Errors are a closed set (`SocialProviderError` with `code`, `retryable`, optional `retryAfterMs`): `AUTH`, `RATE_LIMITED`, `INVALID_REQUEST`, `NOT_FOUND`, `CONFLICT`, `UNAVAILABLE`, `DISABLED`. Messages never carry response bodies, tokens or request content.

## Adapters

* **FakeProvider**: in-memory, deterministic, injectable failures; honours the idempotency key (same key returns the same post). The only provider the worker script can use.
* **ZernioAdapter** (`zernio-adapter.ts`, the only file that names the vendor host): documented HTTP shapes, injectable `fetch`, bounded retries with backoff and `Retry-After`, `Idempotency-Key` on post creation. Hard-disabled by `ZERNIO_LIVE_NETWORK = false`: without an injected `fetch` the adapter throws `DISABLED` before any request, and the registry never injects one. Only tests inject a mock.

## Data model (migration 0049)

All tables: tenant FK, composite keys, FORCE RLS, `harvest_app` policy on `app.tenant_id`, owner policies for definers, no DELETE grant except where noted.

* `social_connections`: provider, platform (five launch networks), external account ref, status (`active|disabled|revoked`), health (`unknown|healthy|degraded|failing` plus a fixed code), sealed credential envelope (jsonb, AES-256-GCM, AAD bound to tenant and connection, key id recorded for rotation). One live row per `(provider, external_account_ref)` across all tenants, so an account can never feed two ministries.
* `social_posts`: the queue item and the audit-friendly record. Status `draft|scheduled|publishing|published|failed|cancelled`, guarded by a trigger (legal transitions, immutable identity, status-shaped column checks). Holds content and media references (these are the ministry's own publishable text), the provider idempotency key, lease fields, attempts, provider post ref, fixed error code.
* `social_webhook_events`: idempotency and audit of inbound events. **No message text, sender names or comment bodies are stored**; only ids, type, account/subject refs, timestamps, a body hash and an allow-listed `detail` (status, error category, platform).
* No inbox cache table. Conversations and messages are read live through the port.

Scheduling ownership: **Harvest schedules, the provider publishes on request.** At due time the worker asks the provider to publish now with the post's idempotency key. The provider is never given a future time, so cancelling is local and the provider and Harvest cannot both publish. (Alternative, provider-side scheduling, is an open decision.) Because the post row is itself the queue item, publishing does not use the jobs table: one source of truth, no second record to drift. Webhook processing does use the shared outbox and job handlers.

## Posting path and delivery semantics

`schedulePost` writes the row (`scheduled`, `scheduled_for`). The worker (`scripts/run-social-publisher.ts`, role `harvest_worker`, no table privileges) calls two SECURITY DEFINER functions: `social_publish_claim` (leases due rows, bumps `attempts`, returns what the call needs, including the sealed envelope) and `social_publish_complete` (lock-token checked; outcome `published|retry|failed`). The provider call happens outside any transaction. It is **hard-disabled**: the script refuses unless `HARVEST_SOCIAL_PUBLISHER=test` and a local database, and only ever constructs the FakeProvider.

At-most-once (assuming the provider honours `Idempotency-Key` for 24 hours, unverified): a crashed claim is retried with the **same** idempotency key only inside 23 hours of the first attempt (the provider dedupes for 24 hours). Past that the post is failed with `IDEMPOTENCY_WINDOW_EXPIRED` and surfaced for a person, never resent blindly. The same rule applies to a `scheduled` post that has had any attempt (a retry waiting out its backoff, a long worker outage): it is failed, never claimed. A post that has had an attempt can no longer be rescheduled, edited or sent back to draft (database guard); a person cancels it and creates a new post. Retryable errors back off exponentially (honouring `retryAfterMs`) up to `max_attempts`; permanent errors fail at once.

## Webhooks

`POST /api/integrations/social/webhook/[provider]`. Order: integration enabled? -> bounded raw body -> signature (HMAC-SHA256 hex of the raw body, constant-time, current and retired secrets, secret derived from the key provider purpose `social-webhook:v1`) -> parse -> resolve the tenant from the DB by `(provider, account ref)` through a definer (never from the payload's tenant-looking fields) -> event-age bounds -> insert under the resolved tenant context (unique `(tenant, provider, event id)`) -> outbox `social.webhook`. Every refusal before the signature is trusted (disabled, unknown provider, wrong content type, too large, unreadable, bad signature) returns the same 404 and body and never touches the database. Once the signature is valid, everything that cannot or should not be applied (duplicate, unknown or revoked account, event too old or too new, unrecognised or unparseable) gets the same 202 as a new event, so the provider does not retry it for two days and nothing about our tenants is revealed. The signature check always runs over every accepted secret, even for a missing header, so timing does not separate the refusals.

The provider signs only the body (no timestamp), so replay protection is event-id uniqueness plus an age window (assumption: retries span about 51 hours, window 72 hours; rows must therefore be kept at least 30 days: retention TODO below).

## Security model

* Credentials: only sealed envelopes in the DB; opened only in the worker process and the service call that needs them; never logged, audited or placed in errors. New key purposes `social-credential:v1` and `social-webhook:v1` go through the existing key provider registry; no environment secret is needed to run tests (test provider override).
* Tenancy: tenant from the verified session (`withTenant`), RLS on every table, cross-tenant lookups only through narrow definers granted to one role each.
* Permissions: `social:connect`, `social:schedule`, `social:inbox`; owner/admin only by default, unknown roles denied. Audit rows hold ids and states only.
* Account ownership: a connection can only be created for an account ref the provider returns under that credential (`listAccounts`), never from a free-typed id.
* Kill switches are constants, not environment toggles: `SOCIAL_INTEGRATION_ENABLED = false` (all routes and the webhook answer the uniform unavailable response), `ZERNIO_LIVE_NETWORK = false`. Tests assert both and a source guard keeps vendor host and HTTP client inside the adapter.

## Test plan

Contract suite run against FakeProvider and ZernioAdapter-with-mock-fetch; adapter request shapes, error mapping, retry/backoff, idempotency header, zero calls when disabled; webhook signature, replay, tenant resolution, uniform responses, age bounds; DB: RLS matrix (owner/admin allowed, member/viewer/other tenant denied), state-machine legality, credentials never plaintext (DB, audit, logs scanned for a canary token), restricted-owner path, worker role privileges, publisher end-to-end against the fake; source guards.

## Open decisions and gates (all UNAPPROVED; none decided here)

1. **DPA** with the provider and sub-processor review. Blocks any real data. Default: no real data.
2. **Sandbox account** and a dated per-platform capability matrix verified against it. Docs read here are public pages, not verified behaviour.
3. **OAuth connect flow ownership** (who hosts selection screens, redirect URL, state handling, tenant binding). Default: not built; accounts can only be linked from provider-listed refs.
4. **Per-ministry vs platform API key, and the webhook signing model. GATE (UNAPPROVED, blocks activation).** Default as built: a sealed per-connection credential (works either way) and **one platform-wide webhook signing secret** (the provider's endpoint is team-wide, limit 50 endpoints). Consequences that must be settled before any activation:
   * If each ministry owns its own vendor team and Harvest registers the webhook there, the ministry can read the shared secret in the vendor dashboard. It could then sign events naming **another ministry's** account (for example `post.failed`, or `account.disconnected` to revoke that ministry's connection) and every check would pass: signature valid, account resolves, tenant taken from our own record.
   * Account squatting: tenant resolution trusts the first live connection for a provider account. A ministry whose credential can see an account could link it first and receive that account's events; the schema only guarantees one live owner, not that it is the right one.
   * Required gate, one of: **(a)** a single Harvest-owned vendor team, so no ministry ever holds the secret or a credential that lists other ministries' accounts; or **(b)** a per-connection signing secret (derived, not stored) with a per-connection unguessable endpoint token in the webhook URL, so a signature only counts for the connection it was minted for (this also needs per-connection endpoints, which meets the 50-endpoint limit at scale). The sandbox must verify whichever is chosen before activation. Not built: nothing is activated, and per-connection secrets are not prepared in code.
   * Note: `social_resolve_account` returns tenant and connection for any account ref to application-role SQL by design (the webhook route has no signed-in user); it is the only cross-tenant read and returns two ids.
5. **Rate limits and quotas** (60/600/1,200 requests per minute by connected-account count, shared by all tenants under one key). No per-tenant throttling is built.
6. **Providers and features at launch** (five priority networks only so far; Blogs, ads, analytics not started).
7. **Auto-DM support per platform** and its consent/opt-out/window rules. Not built; replies/Auto-DMs gated by the consent layer.
8. **Scheduling ownership** (Harvest-owned as implemented vs provider-side).
9. **Zero-content-retention** provider setting per profile and what Harvest may store of inbox content. Default: store none.
10. **Retention** for `social_webhook_events` (TODO: purge job; keep at least 30 days) and for published post content.
11. Credential key rotation job for social envelopes (envelopes record the key id; no rotation worker yet).
12. Webhook endpoint registration and secret provisioning (not built; would be a live call).
13. Publishing media: how R2 files become provider-fetchable URLs, and real malware scanning (still `skipped` in `files/scanner.ts`).

## Assumptions recorded from public docs (unverified against a sandbox)

Base `https://zernio.com/api/v1`; `Authorization: Bearer`; `POST /posts` with `Idempotency-Key` (24 hours); statuses `draft|scheduled|publishing|published|partial|failed|cancelled`; webhook header `X-Zernio-Signature` (hex HMAC-SHA256 of the raw body) and `X-Zernio-Event-Id`; payload `{id, event, timestamp, account{accountId}, post{id}, message{...}}`; inbox under `/inbox/conversations`, `/inbox/comments/{postId}`; error envelope `{error, type, code, param}`; 429 with `Retry-After`. `post.partial` is mapped to a failed post with a fixed code (retrying only failed platforms is not modelled). A 409 "duplicate content" answer is treated as a failure, not as success: with our own idempotency key it can only mean different, earlier content. Provider-side `publishing` after a publish-now call is possible, so an accepted post stays `publishing` (lock released, provider reference set) until a webhook or a status read settles it; unconfirmed after 72 hours it fails as `UNCONFIRMED` for a person.
