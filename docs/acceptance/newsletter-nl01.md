# Newsletter NL-01 — server foundation

Built for local synthetic verification, **UNAPPROVED, not activated**. All five HC-02 decisions remain UNAPPROVED; production collection/delivery are hard-disabled and production migrations 0031+ remain unapplied. This slice has no sender, provider, outbox delivery, webhook, double opt-in, preference centre, template, analytics, screen or navigation change.

## Model and reuse

Migration `0056_newsletter_nl01`, stacked after the unmerged Live L1 candidate 0055, adds:

- Audiences grouping lists; lists belong to exactly one same-ministry audience.
- Subscribers uniquely referencing a canonical CRM contact within the ministry. No name, email, phone or duplicate person is stored. The same subscriber can join several lists/audiences.
- Per-list subscription state: subscribed, unsubscribed, bounced, suppressed, with optimistic version and a FK to the canonical consent event used for a subscribe operation. `purpose` is constrained to the existing `newsletter` purpose. List state does not grant consent.
- Global subscriber suppression, sticky until a separately designed reinstatement policy exists; per-list suppression is also sticky. A later consent grant or import replay never clears either suppression. Bounced and unsubscribed states remain unchanged until an explicit state mutation, even after a grant.
- Bounded normalized subscriber tags (50 labels, each 1–40 safe characters), separate from personal contact data. CRM currently has no canonical tag table to reuse; these labels have no grant/consent meaning.
- Segments referencing existing shared CRM **person** saved views at an explicitly pinned version, not copied predicates. Reads resolve current definitions and use `peopleQuery`/the shared CRM compiler. Private views, company views and views with source rules are refused; if a referenced view is edited, becomes private/invalid/source-restricted, evaluation fails closed until an owner/admin creates a fresh link. Deleting the canonical view cascades its segment links and does not break CRM view deletion. A segment never subscribes or grants consent to matching people.
- Separate immutable import provenance, owner/admin-only under RLS, following CRM's source-access restriction. Source, import batch FK, row number, imported-at and actor refer to an already-applied, non-reverted CRM contact source event. The existing CRM CSV pipeline creates/links the contact first; newsletter adds no CSV parser, person creation or consent import. Manual additions have no batch/time provenance. Creating a subscriber transactionally advances the canonical contact version so existing CRM import rollback keeps the now-used contact rather than failing on a new dependent FK. Replays preserve the first provenance and suppression and do not silently update tags.

All six tables have FORCE RLS and tenant-scoped composite references. Owner/admin manage; ministry members read subscriber metadata/effective states, lists and segment metadata; viewers and outsiders read nothing. Members cannot inspect import provenance or mutate newsletter rows even with direct app-role SQL. No DELETE grant exists. Ordinary writes run as the authorized app role under RLS, with contact/subscriber locks and transaction-bound audit rows. One trigger-only SECURITY DEFINER hook purges newsletter subscriptions, private provenance and the subscriber during controlled contact erasure, before CRM rekeys consent/contact ids. It has scoped owner policies, fixed `search_path = pg_catalog, pg_temp`, no app/PUBLIC execution grant, and clears its context on success/error. The app still has no direct DELETE privilege. Trigger/helper functions have fixed `search_path = pg_catalog, pg_temp` and PUBLIC execution revoked.

## Consent and concurrency

Every subscribe operation locks the canonical live contact and subscriber, calls `mayContact(tx, tenantId, contactId, 'newsletter', 'email')`, and stores only that returned consent id. The existing ledger remains authoritative. A database trigger provides a defense-in-depth SQL check against that same ledger; integration tests compare it to `mayContact` rather than introduce a second consent model or writable flag.

An email grant is required. A withdrawal on **any channel** remains outstanding until a later grant on that same channel is later on both occurred-at and recorded-at clocks. A later email grant cannot clear an outstanding SMS/social withdrawal; a backdated same-channel grant cannot clear it either. No grant, latest unknown, redacted evidence, erased contact, wrong tenant and other-purpose consent fail closed. These follow HC-DEC1b/0050 semantics; no purpose or rule is widened.

Reads return an **effective** state: global/list suppression wins; a stored subscribed marker with no current consent is presented as unsubscribed. The stored state and historical consent FK are not send authority and do not mutate the append-only ledger. A later sender must re-check `mayContact` immediately before every delivery and enforce all list/suppression/activation gates; no sender exists here. A ledger withdrawal does not rewrite stored historical subscription markers in this slice.

Optimistic subscription/subscriber versions reject stale edits. Contact locks serialize subscription decisions with existing consent recording/erasure and duplicate subscriber additions. Failed consent, foreign references or audit writes roll back the transaction. Audit metadata holds ids, states, versions and source categories, never contact methods, tags, names, CSV contents or consent evidence. Denied attempts are not separately logged; the platform has no reviewed denial sink/retention policy.

## Services, routes and pagination

`src/server/newsletter.ts` owns audience/list creation, canonical subscriber addition, tag/suppression updates, list state mutations, segment linking, configuration pages and subscriber pages. `newsletter:manage` is owner/admin; `newsletter:read` is owner/admin/member. These are engineering defaults, not an approved privacy/access policy.

API routes below `/api/workspaces/[tenantId]/newsletter`:

- `GET/POST audiences`, `GET/POST lists`, `GET/POST segments`.
- `POST subscribers`; `PATCH subscribers/[subscriberId]` for versioned tags or irreversible suppression.
- `GET lists/[listId]/subscribers` with optional tag/segment filters.
- `PUT lists/[listId]/subscribers/[subscriberId]` with state and current version (0 for a first list state).

Collections use immutable UUID ascending keysets (`after`), default 50, maximum 100, one-row lookahead and an explicit next cursor. No capped page is reported as a total. Segment ordering uses the fixed subscriber UUID cursor while its selection predicates reuse CRM; an edit can change membership between requests, so this is not a snapshot export.

The route wrapper checks the unconditional production-off gate **before authentication or database creation**, verifies session and origin for writes and returns private/no-store JSON. Services also enforce production refusal. No environment value turns newsletter collection on. Database SQL functions do not inspect NODE_ENV; future deployment/privilege decisions are separate controls.

## Evidence and boundaries

Focused tests cover the permission matrix, effective-state/suppression rules, safe tags/provenance, bounded cursors, production refusal, real local CRM CSV import → provenance linkage, retained-contact import rollback, canonical-view deletion, pinned-view invalidation, controlled erasure before rekeying, grant/withdrawal/unknown/none, broad withdrawal and two clocks, sticky suppression, stale versions, two-tenant/direct-RLS denial, saved segment predicates, SQL/gate parity, audit fields and all FORCE-RLS tables. Integration uses `testDatabase({migrationOwner:true})`, explicitly upgrades from 0055, and replays the chain. A fetch spy rejects network requests and confirms none occurred.

The final PR records local lint/typecheck/unit/integration/build counts and fresh independent review. Not verified: CI at the final head, trusted-main Neon migration check, browser, production/environment provisioning, legal/privacy notices and retention policy, operational rate limits or load. **A Neon migration run from trusted main is needed** for this migration PR. No production migration was applied.

CRM merge does not migrate newsletter list memberships/provenance or carry suppression to a kept contact; controlled erasure now purges the source newsletter rows. Merge-safe suppression/transfer therefore remains an explicit pre-collection gate: do not claim that suppression survives a CRM merge. Audit retention and operational rights-request handling also remain unapproved. No claim of production readiness or full rights-request completion is made.

## Open founder decisions (recommended defaults)

- Roles: recommend owner/admin manage and member read, viewer denied; import provenance stays owner/admin-only. Broader CRM contact visibility is already an unresolved HC-02 prerequisite.
- Suppression reinstatement: recommend no reset endpoint in NL-01; define an explicit reviewed workflow later, never clear on a grant or import.
- Existing-list markers after withdrawal: recommend keep the ledger authoritative and expose effective state as now; any future automatic stored-state propagation needs its own transactional lifecycle design.
- Retention, CRM merge suppression/transfer, adult/minor eligibility and notices: require privacy/legal review and tested hooks before any real subscriber collection; no duration or legal basis is approved here.
- Later provider, double opt-in and preference centre are NL-02 onward; this slice selects no contract, implements no provider and sends nothing. Founder scope direction names a future newsletter adapter, but it is not used here.
- UI/navigation/message keys remain with the UI workstream; none were added or requested as a prerequisite for this disabled server foundation.


## Independent review follow-up

The fresh reviewer reproduced three existing-flow regressions at initial head `3f16b97`: imported-contact rollback, shared-view deletion and controlled contact erasure were blocked by the new foreign keys. All three are addressed by the bounded lifecycle rules above and regression tests retained from the independent reproductions. The final PR records the reviewer's exact-head recheck. No previous approval or production readiness is implied.
