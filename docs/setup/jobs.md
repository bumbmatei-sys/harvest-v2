# Jobs and webhook primitives (PR 04)

Phase 1 adds PostgreSQL jobs, a transactional outbox, a signed synthetic webhook receiver, and an explicit operator drain/replay path. It adds no UI, automation designer, social adapter, payments, email sending, cloud queue, or cloud scheduler. Based on `origin/main` at `304b0b5` and the founder overrides in `docs/prd/PRD-v2.7-companion.md`.

## Storage and tenant boundary

Migration `0010_jobs_webhooks` adds:

| Table | Purpose |
| --- | --- |
| `jobs` | Durable work, unique `(tenant_id, idempotency_key)`, status, lifetime/per-run attempts, retry budget, scheduling, lease owner/token, safe error code |
| `outbox_events` | Domain events written in the producer's transaction; unique tenant idempotency key; dispatch timestamp |
| `external_webhook_events` | Immutable verified raw UTF-8 body, SHA-256 digest, provider event ID, connection, resource sequence and source timestamp |
| `webhook_resource_states` | Small synthetic projection used to demonstrate monotonic, idempotent processing; not a real integration model |

All four tables have forced RLS and transaction-local tenant context, using the existing non-owner, non-superuser `harvest_app` role. Composite tenant foreign keys prevent cross-workspace projection references. No context means no visible rows. Runtime grants prevent editing job identity/payload, editing outbox content, or changing/deleting raw webhook events. An append-only trigger also blocks accidental owner mutation of webhook audit rows.

Job HTTP reads/replays require a verified Better Auth session and owner/admin membership. URL workspace IDs are only hints until `withTenant` verifies membership and permission. Webhook requests have a separate signature capability: tenant identity comes exclusively from the verified server-side connection configuration. `x-harvest-workspace` is never read by these primitives.

## Transactional enqueue

Use `enqueueJob(tx, tenantId, input)` or `appendOutboxEvent(tx, tenantId, input)` from `src/server/jobs/outbox.ts` **inside the existing domain transaction**, after its normal authorization. Do not open another connection or enqueue after committing the domain write.

```ts
await withTenant(db, verifiedUserId, workspaceHint, "settings:write", async (tx, tenantId) => {
  await tx.update(workspaces).set({ name }).where(eq(workspaces.tenantId, tenantId));
  await appendOutboxEvent(tx, tenantId, {
    kind: "domain.receipt",
    idempotencyKey: operationId,
    payload: { type: "workspace.updated" },
  });
});
```

This is an example integration point, not an extra PR 03 behavior change. The webhook receiver is a working producer: raw audit insertion and outbox insertion commit or roll back together. Avoid copying personal data into event payloads; deletion/export requirements must be designed before adding a domain consumer.

Idempotency compares a SHA-256 fingerprint of kind and canonical JSON payload (including sorted nested object keys). An equivalent repeat returns the original row, including after success or DLQ/replay. Different content under the same key returns a conflict. The first accepted schedule/retry budget wins. Keys are tenant-scoped and retained; no cleanup in this phase removes dedupe history. Use distinct key namespaces per producer. Job keys are at most 200 characters, outbox keys at most 190; JSON objects are limited to 64 KiB in PostgreSQL. Job retry budgets are 1–20 attempts, default 5.

Outbox dispatch locks undispatched rows with `FOR UPDATE SKIP LOCKED`, creates jobs using `outbox:<outbox-event-uuid>`, and records dispatch in one transaction. Failure leaves the event undispatched and retryable. Repeated or concurrent dispatch cannot create duplicate jobs. Dispatching future events is safe: their jobs retain `scheduled_for` and cannot run early.

## Drain, retries, crashes and replay

The in-repo operator command uses the existing application role and verifies that the supplied operator is still an owner/admin of the selected workspace. It rejects superuser/BYPASSRLS/other role connections. A user ID on this trusted CLI is an operator assertion; it is never accepted as authentication from HTTP. It does not load `.env.local` or set up infrastructure. Set `DATABASE_URL` in the process environment to an **already authorized local** application-role database; do not use a cloud connection while validating this PR.

```sh
npm run jobs:drain -- <operator-user-id> <workspace-uuid> drain 50
npm run jobs:drain -- <operator-user-id> <workspace-uuid> replay <job-uuid>
npm run jobs:drain -- <operator-user-id> <workspace-uuid> drain 50
```

Each invocation dispatches up to the requested batch size, then claims/runs at most that many jobs (1–100; default 50). It exits when no due jobs remain; rerun it after a scheduled retry is due. No resident daemon or cloud cron is configured.

- Claims use `FOR UPDATE SKIP LOCKED` and a fresh UUID fencing token with `locked_at`/`locked_by`. The lease is 60 seconds. Active workers skip rows another transaction holds.
- Claims increment lifetime `attempts` and per-run `run_attempts`. Expired claims can be reclaimed; the exhausted final claim goes to `dead_letter` with `LEASE_EXPIRED`.
- Running verifies the current token and unexpired lease while holding the job row lock. An expired/reclaimed token cannot invoke a handler. Concurrent execution of the same token produces one completion and one `stale_claim`.
- Handlers run in a savepoint. On failure their database writes roll back; the outer transaction saves retry/DLQ state. Retry delay is `min(1 hour, 1 second × 2^(run_attempts - 1))`, based on the database clock.
- Only fixed codes are persisted: `HANDLER_FAILED`, `INVALID_JOB_PAYLOAD`, `UNSUPPORTED_JOB_KIND`, `LEASE_EXPIRED`. Exception messages, provider responses, signatures and credentials are never logged or stored as diagnostics.
- Included handlers perform database-only work. `domain.receipt` deliberately acknowledges an event without a released downstream consumer. `webhook.synthetic` updates the synthetic projection. Handler effect and successful completion commit together.
- Replay accepts only `dead_letter`, audits `job.replay`, resets per-run attempts, increments replay count and schedules the **same** job immediately. Lifetime attempts, payload, idempotency key and prior error remain for diagnosis until success. Replaying queued/running/succeeded work returns 409. Fix the handler/cause first; replay does not edit payloads or bypass dedupe.

A handler must await all work and use the supplied transaction. Phase 1 has no outbound handlers. A future external handler must pass a stable tenant/job idempotency key to the provider and reconcile ambiguous results. A database transaction alone cannot guarantee exactly-once external sends or charges. Long handlers need a separate lease/heartbeat design before introduction; do not put external calls or unbounded work inside these short database transactions.

## Synthetic webhook contract

`POST /api/integrations/webhook/synthetic` is disabled unless `HARVEST_SYNTHETIC_WEBHOOKS` is configured. Other providers return 404. No real provider key or adapter is included.

The environment variable is a JSON array of `{ "id": "local-connection", "tenantId": "<existing-workspace-uuid>", "signingKey": "<random-local-test-key-at-least-32-characters>" }`. It is server-only; never use a `NEXT_PUBLIC_` variable. Connection IDs must be unique and use letters, digits, `_` or `-`. Use a newly generated local test key, and never print it. Removing a connection disables its receiver. This configuration is explicit local/test scaffolding, not an integration credential management system.

The body is a strict JSON object:

```json
{
  "id": "synthetic-event-001",
  "resourceId": "synthetic-resource-001",
  "sequence": 1,
  "occurredAt": "2026-11-05T12:00:00Z",
  "data": { "value": "ready" }
}
```

IDs are 1–100 characters, sequence is an integer from 0 to 2147483647, and value is at most 200 characters. Unknown fields are rejected; the contract supports no real domain effects.

Required headers:

| Header | Meaning |
| --- | --- |
| `Content-Type: application/json` | JSON only |
| `x-harvest-connection` | ID of the configured connection |
| `x-harvest-timestamp` | Unix seconds as a ten-digit string |
| `x-harvest-signature` | Lowercase hex HMAC-SHA256 over `synthetic.<connection-id>.<timestamp>.` followed by the exact raw body bytes |

`signSyntheticWebhook` in `src/server/webhooks/synthetic.ts` is the test signer. For a local request from a TypeScript script with the same environment configuration:

```ts
import { readSyntheticConnections, signSyntheticWebhook } from "./src/server/webhooks/synthetic";
const [connection] = readSyntheticConnections();
const body = Buffer.from(JSON.stringify({
  id: "synthetic-event-001", resourceId: "synthetic-resource-001", sequence: 1,
  occurredAt: new Date().toISOString(), data: { value: "ready" },
}));
const timestamp = String(Math.floor(Date.now() / 1000));
const response = await fetch("http://127.0.0.1:3000/api/integrations/webhook/synthetic", {
  method: "POST", body,
  headers: {
    "content-type": "application/json", "x-harvest-connection": connection.id,
    "x-harvest-timestamp": timestamp,
    "x-harvest-signature": signSyntheticWebhook(body, connection.id, connection.signingKey, timestamp),
  },
});
console.info(response.status, await response.json());
```

Verification uses constant-time comparison and a ±5 minute timestamp window. The receiver bounds streaming input to 64 KiB even without a Content-Length header, verifies the signature **before** parsing or writing, and retains the exact verified UTF-8 body. Rejected unauthenticated requests are not persisted. Do not log request headers/body or signatures. Identical provider event IDs/bodies return `{ accepted: true, duplicate: true }` with 202; conflicting content or connection reuse under the same tenant/provider event ID returns 409. A retry outside the timestamp window must be signed again, with the same event ID/body.

Source sequence determines state, independently of arrival/source time. An atomic resource-key upsert only applies a strictly larger sequence. Equal/older events remain in raw audit and their jobs succeed without changing state. Connection ID is part of the projection key. Duplicate receipt, retry and DLQ replay cannot apply the same event twice or regress newer state. Real adapters must define their own ordering/reconciliation rules before release.

## Operator API

All operator endpoints return `Cache-Control: private, no-store`. List endpoints accept `page` (default 1, 50 rows per page) and return `{ rows, page, hasMore }`.

- `GET /api/workspaces/:tenantId/jobs?status=dead_letter&page=1` — metadata, status, lifetime/per-run attempts, retry budget, replay count, schedule, lock time and last error. Payload, raw body, idempotency key and claim token are omitted.
- `GET /api/workspaces/:tenantId/webhook-events?page=1` — event metadata; no raw body or payload.
- `POST /api/workspaces/:tenantId/jobs/:jobId/replay` — empty body; requires a same-origin `Origin` header and owner/admin session. Returns `{ id, status, replayCount }`.

No public drain endpoint exists. Operator endpoints return 401 without a session, 403 for insufficient membership/permission, 404 for another workspace's job ID within an authorized workspace, and 409 for a non-DLQ replay. The receiver returns 400 for malformed JSON/schema, 401 for invalid/expired signature, 404 for unknown provider/connection, 409 for conflicting event ID reuse, 413 for oversized body and 415 for unsupported content type. Unexpected errors return the existing sanitized 500 response.

## Validation and operational limits

```sh
npm run lint
npm run typecheck
npm test
npm run test:rls
npm run test:e2e
npm run build
npm run test:pwa
```

Unit tests cover canonical idempotency, backoff bounds, permissions, exact-byte signatures and malformed/timestamp boundaries. Integration tests migrate twice with the real `harvest_app` role and exercise domain/outbox rollback, dispatch rollback, concurrency/locks, scheduling, fencing, partial and PostgreSQL handler failures, retry/DLQ/replay, raw audit immutability, receiver rollback, dedupe, ordering, cross-tenant reads/writes/worker/replay denial, transaction context reset, and the actual drain CLI. Existing Playwright/accessibility/PWA and i18n/theme/source guards remain regression gates; no UI or new Playwright scenario is added.

Tests use disposable local PostgreSQL (or an explicitly supplied local `harvest_test` database). Existing email tests mock delivery; no outbound email is needed. The Neon CI resource-creation job is skipped for `feat/pr04-jobs-webhooks`, while local PostgreSQL migration/RLS checks remain enabled. No Neon branch, cloud cron, deployment or merge is part of this PR.

Before real provider rollout: define provider ordering and remote idempotency contracts, connection/credential rotation and revocation, event retention/export/erasure requirements, queue monitoring/alert thresholds and production scheduling. These are future release decisions; Phase 1 does not claim production adapter readiness.
