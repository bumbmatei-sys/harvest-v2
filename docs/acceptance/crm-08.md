# CRM-08 acceptance record: CRM events, outbound webhooks and AI-readable tools with approval gates

Date: 2026-11-07.

Scope: PRD v2.5 §5A.4 CRM-08 asks for "workflow triggers, API/webhooks, AI-readable tools with approval gates; incremental based on phase readiness". The PRD v2.7 companion adds 5.-06: "activity creation events emitted via outbox to AI/context and automation consumers". The AI assistant architecture (§4) requires a central tool registry with validated schemas. In that registry the backend executes tools and enforces tenant, permission and approval checks itself.

This slice builds the **phase-ready foundation**, not the features that depend on it:
- typed CRM event contracts on the existing outbox;
- a consumer boundary;
- the smallest outbound CRM webhook delivery;
- CRM read tools and approval-gated write tools for a future assistant.

It does not build a workflow designer, an AI chat or model gateway, a general integration platform, or email/calendar sync.

## What existed before (reused, not duplicated)

- **Transactional outbox and job queue** (`src/server/jobs/*`):
  - `appendOutboxEvent` in the domain transaction;
  - `dispatchOutbox` turns events into jobs keyed `outbox:<event id>`;
  - leases, backoff, dead letter and replay;
  - an operator drain (`npm run jobs:drain`).
- **Inbound webhooks only:** a signed synthetic receiver (`src/server/webhooks/receiver.ts`). There was no outbound delivery.
- **CRM events existed only as no-op receipts:** tasks, notes, imports, merge and recorded activities. People, Organizations, consent and deals emitted nothing.
- **No AI tool registry and no approval mechanism** existed anywhere in the code.

## 1. Event contracts and emission

`src/server/crm-events.ts` holds one registry of 25 typed, versioned contracts, all at `version: 1`.

| Area | Events |
| --- | --- |
| People | `crm.person.created`, `crm.person.updated` (changed field names), `crm.person.consent_recorded` (purpose, channel, status), `crm.person.organization_linked`, `crm.person.organization_link_updated`, `crm.person.organization_unlinked` |
| Organizations | `crm.organization.created`, `crm.organization.updated` |
| Deals | `crm.deal.created`, `crm.deal.updated`, `crm.deal.stage_changed` (from/to stage and `toStageKind` open/won/lost), `crm.deal.archived`, `crm.deal.restored` |
| Tasks, notes (CRM-05, payloads unchanged) | `crm.task.created/updated/completed/reassigned`, `crm.note.created/updated/archived` |
| Imports, merge (CRM-06, unchanged) | `crm.import.completed/failed/rolled_back`, `crm.merge.completed` |
| Recorded activities (CRM-07, unchanged) | `crm.association.recorded` |

**Rules**

- **Single emission path.** `emitCrmEvent(tx, …)` is the only way CRM code emits an event. It validates the payload against its **strict** schema, so an extra key fails the write instead of leaking. It also refuses a tenant mismatch. It then writes the outbox row in the caller's transaction.
- **Where events come from.**
  - People and Organization events come from `recordActivity`. The ledger row id is the idempotency key, so each write that goes through it emits exactly once. No route emits anything.
  - **Not covered by per-record events:** People and Organizations created or filled by a CSV import, and custom field edits (CRM-03). Those paths write their ledger rows directly. An import is visible only as the aggregate `crm.import.completed` (counts); custom field edits emit nothing. See "Deferred".
  - Consent events come from `recordConsent`.
  - Deal events come from `createDeal`, `updateDeal` and `moveDeal`, keyed by the version they produced.
  - Existing CRM-05/06/07 emitters now call `emitCrmEvent` too.
- **Payloads are minimal.** They carry ids, categories and changed field **names** only. They never carry:
  - names, emails, phones or handles;
  - note, task or description text;
  - deal amounts or close reasons;
  - import cells;
  - consent source or evidence;
  - recorded-activity summaries or payloads.

  `contactId` is always top-level, so the existing erasure scrub nulls it in the outbox and in jobs. Contracts therefore accept a null `contactId`.
- **Event identity.** The outbox row id is the stable event id, and the outbox `created_at` is `occurredAt`.
- **Versioning.** A breaking payload change gets a new version; additive optional keys do not.

**Consumer boundary** (`src/server/jobs/handlers.ts`)
- Every contract type has one job handler.
- It accepts only jobs dispatched from the outbox (`outbox:<uuid>` key and a matching outbox row).
- It rebuilds the envelope `{ id, type, version, tenantId, occurredAt, data }` and validates the payload against the contract. An invalid payload means `INVALID_JOB_PAYLOAD`, then retry and dead letter, and no subscriber is called.
- It then calls each subscriber that accepts the type, inside the job transaction.
- Today's only subscriber is outbound webhooks. Workflow and AI/context subscribers are **not implemented** (see "Deferred").

## 2. API and outbound webhooks

**Existing CRM API**
- It already enforces a verified session, membership from the server-side session (`withTenant`), role permissions, zod validation, the origin check on writes, and FORCE RLS.
- No parallel CRUD was added.

**Endpoint management (API only, owners and admins)**

| Route | Purpose |
| --- | --- |
| `GET /api/workspaces/:id/crm/webhooks` | Endpoints, the list of event types, and whether delivery is enabled. Secrets are never listed. |
| `POST /api/workspaces/:id/crm/webhooks` | Creates an endpoint. Returns the signing secret **once**. |
| `PATCH /api/workspaces/:id/crm/webhooks/:endpointId` | Changes the URL, event types or status, or rotates the secret (`rotateSecret: true`, returned once). Optimistic `version`. |
| `DELETE /api/workspaces/:id/crm/webhooks/:endpointId` | Removes the endpoint and its deliveries. |
| `GET …/:endpointId/deliveries` | The last 50 outcomes: status, attempts, code and times. No URL, body or headers. |

- Permission is the new `webhooks:manage`, held by owners and admins. Members and viewers get 403. Another workspace gets 403 (membership), and foreign endpoint ids get 404.
- At most 10 endpoints per workspace, serialized with an advisory lock.
- The audit ledger records the **host only**, never the path or query.

**Delivery** (`src/server/crm-webhooks.ts`, `src/server/webhooks/destination.ts`)
- **Fan-out.** The webhook subscriber writes one `crm_webhook_deliveries` row per active endpoint subscribed to the type. A unique `(endpoint, event)` key makes job retries and replays create nothing new.
- **Sending** is an operator pass, `runWebhookDeliveries`, also available as `npm run jobs:drain -- <user> <workspace> deliver`, and needs `jobs:operate`. It works **one delivery at a time**:
  1. claim it in a short transaction (`SKIP LOCKED`, lease token);
  2. send it with **no transaction open**;
  3. record the outcome against the lease token;
  4. then claim the next one.

  A lease (60 s) only ever covers one attempt, which is at most a 5-second lookup plus a 10-second send. So an overlapping pass cannot take over, and re-send, an item this pass is still working on. Crashed leases are recovered (`LEASE_EXPIRED`, which counts as an attempt).
- **Payload.** The JSON envelope is read from the outbox **at send time**, so an erasure that ran after the write is already reflected.
- **Headers and signing.** Requests carry `harvest-event-id`, `harvest-event-type`, `harvest-timestamp` and `harvest-signature: v1=<hex>`. The signature is HMAC-SHA256 over `"<event id>.<timestamp>.<body>"`. The per-endpoint secret is **derived** from a server key (`HARVEST_WEBHOOK_SIGNING_KEY`, at least 32 characters), the endpoint id and a rotation counter. No secret is stored in the database.
- **Destination safety (SSRF).**
  - The URL must be `https://`, port 443, with a DNS name. IP literals (including integer and hex forms), credentials, fragments, single-label names and `localhost`/`.local`/`.internal`-style names are refused.
  - Before **every** attempt the name is resolved, and **every** address must be public. Blocked ranges:
    - private, loopback and link-local (including 169.254.169.254 metadata);
    - CGNAT and documentation ranges;
    - multicast and reserved;
    - IPv6 unique-local, link-local, NAT64, 6to4 and documentation ranges (including 3fff::/20 and 5f00::/16);
    - IPv4-mapped and IPv4-compatible IPv6, judged by the embedded IPv4.
  - The connection is **pinned** to the checked address, so a second DNS answer cannot rebind it.
  - **Redirects are never followed:** a 3xx is a failure (`REDIRECT`).
- **Bounds.**
  - 10-second timeout per attempt; the response body is discarded after 4 KB.
  - At most 6 attempts with exponential backoff, then `dead`.
  - Blocked or invalid destinations go straight to `dead`. A failed or slow address lookup (5-second limit) is a retryable `NETWORK` failure.
  - Disabled or deleted endpoints, and event types the endpoint no longer subscribes to, are `cancelled` at send time.
- **Redacted records.** Only status and error codes are stored, never the URL, body, headers or response.
- **No real deliveries in development.**
  - Sending happens only when `HARVEST_WEBHOOK_DELIVERY=enabled` **and** a signing key is set. Otherwise the pass returns `{ disabled: true }` and claims nothing.
  - Development and the e2e server set neither.
  - Tests inject a recording transport and resolver.

## 3. AI-readable CRM tools and approval gate

`src/server/ai/crm-tools.ts` is the CRM part of the tool registry described in the architecture doc. Each tool has a name, a description, `read` or `write` mode, a permission, a strict zod input (exported as JSON Schema for a model), and a `run` that calls the **same CRM services the app uses**. There is no privileged path and no SQL or record-dump tool.

**Read tools**
- `crm_search_people`, `crm_get_person`
- `crm_search_organizations`, `crm_get_organization`
- `crm_get_timeline` (person, Organization or deal)
- `crm_get_deal`, `crm_list_related_deals`
- `crm_list_my_tasks`

The deal tools avoid `listDeals`, because it can seed a default pipeline as a side effect.

**Output shapes are fixed and minimal.** They never include:
- person notes or custom field values;
- consent source, evidence or recorder;
- note or task body text;
- deal close reasons;
- the content of recorded activities. That content is consent-restricted to its purpose (messaging, form follow-up, newsletter), and assistant processing is not one of those purposes. Activities appear only as source, kind, purpose and time.

**Write tools:** `crm_create_task` (assigned to the caller) and `crm_move_deal`.

**Approval gate** (`ai_tool_approvals`, plus guard trigger `guard_ai_tool_approval`)
1. **Request.** `requestToolApproval` validates the arguments, checks the permission, and stores the tool, the SHA-256 of the canonical validated arguments (defaults included; the arguments themselves are not stored), the requesting person, and a 10-minute expiry.
2. **Decide.** `decideToolApproval` lets **only that person** approve or reject a pending, unexpired approval. It must only be called from a human action in the product, never from a model tool call. No such screen exists yet.
3. **Execute.** `executeCrmTool` for a write tool **fails closed**:
   - without an approval id → 403 `approval_required`;
   - with a pending approval → 403 `approval_pending`;
   - with a different person, tool, arguments or workspace → 403 `approval_mismatch`;
   - with a rejected or already-consumed approval → 409 `approval_used`;
   - with an expired one → 409 `approval_expired`.
4. **Consume.** An approved, matching approval is **consumed in the same transaction as the write**. The CRM service runs inside it and checks membership and role again. A role change after approval → 403 and the approval is not spent. A failed write (for example a stale deal version) → the approval is not spent.
5. **Ledger.** Request, decision and execution are recorded as `ai.tool_approval_request`, `ai.tool_approval_approve` or `ai.tool_approval_reject`, and `ai.tool_execute`.

**SQL guard (independent of the service)**
- Only the requesting person can create, decide or consume an approval.
- Its tool, arguments, expiry and identity never change.
- Transitions are only pending → approved/rejected and approved → consumed.
- Nothing changes after expiry, and there is no DELETE grant.

`describeCrmTools` lists only the tools the caller's role may use (a viewer sees no write tools).

## 4. UX

**No UI was added.**
- Webhook endpoints are an owner/admin API, and sending is off unless a deployment enables it. A settings screen with a working "add endpoint" button would promise deliveries that no scheduler sends.
- The approval review screen belongs to the assistant runtime, which does not exist yet.

No visible copy changed apart from new error messages in `messages/en.json` (provider-neutral, no vendor names), so there are no new screenshots.

## Migration and database

- `drizzle/0025_crm_webhooks_ai_approvals.sql`: main ended at 0024 (CRM-07), and 0025 is the next number. The snapshot `prevId` is 0024's id, the journal index is 25, and no merged migration was renumbered. `drizzle-kit generate` reports no changes and `drizzle-kit check` is clean.
- **Generated DDL:** `crm_webhook_endpoints`, `crm_webhook_deliveries` (composite foreign keys to the endpoint, with cascade, and to `outbox_events`), and `ai_tool_approvals`.
- **Hand-written part:**
  - ENABLE + FORCE RLS with `harvest_app`-only tenant policies;
  - grants: endpoints S/I/U/D, deliveries S/I/U, approvals S/I/U (no delete);
  - the approval guard trigger.
- **Erasure:** none of the new tables holds personal data. Deliveries hold ids; event bodies are read from the outbox, which erasure already scrubs; approvals hold an argument hash. `erase_contact` needs no change.

## Tests (real PostgreSQL 16, application role `harvest_app`, FORCE RLS)

| Area | Test |
| --- | --- |
| Emission and contracts | `crm08-events.test.ts`: one event per write, in order, for People, Organizations, consent, links, deals (create, stage change, update), tasks, notes and activities. Every payload matches its contract, and a payload dump contains no names, identifiers, notes, descriptions, amounts, reasons, bodies, consent evidence or activity content. |
| Atomicity | A failed (stale) write emits nothing. A failing outbox insert rolls back the person it belongs to. |
| Contracts | Extra keys and a tenant mismatch are refused. A repeated key gives one row. Every contract is strict, versioned and free of personal-data keys. |
| Consumer boundary | Subscribers get the validated envelope (`id` = outbox id). A payload outside its contract retries, then dead-letters without calling subscribers. Jobs not dispatched from the outbox are refused. Erased ids are null. |
| Webhooks | `crm08-webhooks.test.ts` covers FORCE RLS, exact grants, and no rows without a tenant context; owner/admin only (member, viewer and other workspaces denied, foreign ids 404); and unsafe URLs, unknown or duplicate event types, a missing key and the 10-endpoint cap. |
| Delivery | Idempotent fan-out, and nothing sent while delivery is off. The body is an envelope signed with the derived secret, sent to the pinned address with a stable event id; the delivery list has no URL or body. Retries with backoff (500, redirect, timeout, then 503 and dead). |
| Overlap and retries (review) | Overlapping passes send each delivery once. A failed DNS lookup is retried, not dead. An unsubscribed type is cancelled. Both new tests fail on the previous implementation. |
| Delivery edge cases | A destination that rebinds to the metadata address or IPv4-mapped loopback is never called. Leases are recovered. Workspace B's operator cannot touch A. Erased ids are sent as null. Disabled endpoints are cancelled. |
| AI tools | `crm08-ai-tools.test.ts` covers role-filtered tool lists with JSON schemas; reads through services with no sensitive fields or activity content; and cross-workspace, unknown-record, unknown-tool and extra-argument denial. |
| Approvals | Fail closed (none, pending, viewer). Bound to person, tool, arguments and workspace. Single use (replay → 409). Rejected and expired refused. Permissions rechecked after a role change. A failed write doesn't spend the approval. The SQL guard holds under RLS. |
| Routes | `tests/e2e/crm08.spec.ts`: session (401), origin (403), member and other workspace (403), unsafe URLs (400), not configured in development (409), no-store, unknown endpoint (404). |
| Destination unit | `tests/unit/webhook-destination.test.ts`: URL rules, blocked ranges (v4, v6, mapped, compatible, expanded forms), any-address rule, signing and secret derivation. |
| Existing suites | `erasure.test.ts`: the outbox scrub assertion now names the CRM-08 person events and checks only rows about the erased person. |

**Mutation checks.** Each was run locally against the real suite and reverted; every file was byte-identical afterwards. All 17 were caught:
- approval argument-hash check; approval actor check; single use; expiry; write without approval;
- note text in the timeline tool;
- the SSRF any-address rule; the delivery off switch; the signature header; fan-out idempotency; redirect treated as success;
- consumer contract validation; strict contract (`passthrough`);
- person event emission; deal stage event;
- RLS `USING (true)` on endpoints;
- the SQL approval guard actor check.

## Commands and results

See the PR description for the final head SHA and the GitHub "Foundation CI" results.

## Independent review

A fresh, separate Claude session reviewed the PR read-only at `034f222`. It found no blockers. Every should-fix item is either fixed or explicitly deferred:

| Finding | Outcome |
| --- | --- |
| **S1.** A pass claimed a batch, then sent its items one by one. Later items could outlive their lease, and an overlapping pass would re-send them; the first pass's results were dropped. | Fixed: one-at-a-time claim, send and record, plus a 5-second lookup limit. Regression test. |
| **S2.** A temporary DNS failure marked the delivery dead on the first attempt. | Fixed: it is now a retryable `NETWORK` failure. Regression test. |
| **S3.** This record overclaimed: imports and custom field edits emit no per-record People events. | Record corrected (section 1 and "Deferred"). |
| **S4.** The approval gate cannot tell the person from a model acting under their session. The approval stores only a hash, so a review screen cannot show what is being approved from server-held data. | Deferred to the runtime as a hard requirement (see "Deferred"). Nothing calls `decideToolApproval` today. |
| Nit: queued deliveries ignored later subscription changes. | Fixed (cancelled at send time). Test. |
| Nit: `3fff::/20` and `5f00::/16` were not blocked. | Fixed. Unit test. |
| Nits: no cap on approval requests; tool outputs contain free text (names, titles, an Organization description) that a model must treat as untrusted data; outbox events still pending when the first endpoint is created will be delivered to it. | Recorded under "Deferred". |

## Deferred (exact remaining work)

- **Workflow automation.** Rules, a trigger/condition/action model, execution logs and a designer. The event contracts and subscriber boundary are ready; no workflow subscriber exists, and nothing executes workflows.
- **AI/context consumer and assistant runtime.**
  - The model gateway (Vercel AI SDK adapter), conversations and memory, usage ledger, budgets, model routing and fallbacks.
  - A context subscriber that indexes CRM events.
  - The **human approval screen** that calls `decideToolApproval`. Until it exists, write tools cannot run in the product; that is deny-by-default by design.
  - Requirements for that screen (from the review):
    - The decision must come from a signal only a person can produce, such as a UI-only route with an origin check plus a one-time nonce or step-up confirmation. It must never be reachable from tool dispatch or by the model, which runs under the same user identity.
    - The approval must hold the canonical arguments, or a server-made summary, so the person sees what they approve from server-held data. If it holds personal data, erasure must cover it.
    - Cap or rate-limit pending approvals per person.
    - Treat every tool output as untrusted data, not instructions (PRD 8.-05). Names, titles and descriptions are free text.
- **Scheduled webhook delivery and a settings UI.**
  - There is no production scheduler for the job drain or the delivery pass; both are operator-run.
  - Enabling delivery needs: a scheduler, `HARVEST_WEBHOOK_SIGNING_KEY` from the secret store, `HARVEST_WEBHOOK_DELIVERY=enabled` per environment, an egress policy review, and then an owner/admin settings screen (endpoints, secret shown once, delivery history).
  - Receivers verify the signature and should reject timestamps older than 5 minutes.
- **Public API keys and OAuth for third-party callers.** The CRM API is session-authenticated only.
- **More events** if consumers need them:
  - per-record People/Organization events for **CSV imports** (today only `crm.import.*` counts);
  - **custom field** value changes (CRM-03; field names are `cf:<key>`, so the field-name contract must allow them);
  - person erasure (it cannot carry the id);
  - pipeline and stage configuration changes.
- **First endpoint backlog.** Outbox events not yet dispatched when the first endpoint is created will be delivered to it. Decide whether to start subscriptions from the creation time.
- **Delivery retention.** Delivery rows and outbox rows are never pruned.
- Email/calendar sync remains out of scope.
