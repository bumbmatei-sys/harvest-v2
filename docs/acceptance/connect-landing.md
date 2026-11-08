# Personalized QR landing editor

Base: merged main `462ce95` (HC-07, PR #31). Migration 0030 follows preserved 0029. Open-PR reconciliation found only parked #16, which changes no migration and remains untouched. Craft reconciliation marked both HC-07 entries merged and moved existing task `398f9eaf-be59-83fb-22b3-47c485f022c0` into Now without duplication. HC-07's existing independent evidence remains in [its review](../reviews/hc-07-independent.md).

## Behavior and boundaries

Campaign QR cards link to a full-width shadcn editor. An optional heading (120 characters), welcome message (600), and eight ordered cards are plain text. Resource cards select an existing Harvest starter resource. External cards have category, title (120), optional description (300), HTTPS destination (2048), and free/paid label. Communities must be free. Move/remove controls preserve keyboard focus and announce positions. Save is explicit; unsaved edits warn on internal navigation, browser history and unload. Browsers without Navigation API use a pre-hydration history event bridge so the editor can block traversal before the router unmounts it: it restores the editor URL/state, asks before discarding, and navigates to the recorded destination only after confirmation. This compatibility path replaces the forward history branch when restoring a dirty editor; it does not assume traversal distance.

The shared renderer presents private draft previews and immutable published content. Free Harvest resources stay prominent and require no identity. External suggestions have explicit category/free/paid badges; surrounding copy distinguishes them from free Harvest resources. They open the exact saved HTTPS URL in a new tab with `noopener noreferrer` and `no-referrer`. No destination fetch, embed, redirect/tracking route or visitor/account/response parameters are added.

Response/account actions stay outside editable cards. They continue to depend on the existing published Forms version and synthetic-mode checks. Protected preview shows the published form configuration with unchecked choices and submission disabled; it mints no submission capability. Personalization cannot change offered purposes, consent, form settings or invitation eligibility. Links without a published customization keep the original generic page.

Images, reusable presets, native community/course/product selection, global Discovery, CRM association, full onboarding and payments are excluded. Production intake and real invitation delivery remain hard-disabled. All five activation decisions remain unapproved. This work authorizes no merge or deployment.

## Persistence and interfaces

Two tenant-scoped FORCE-RLS tables reference `(tenant_id, link_id)` on the owning QR. `connect_landing_states` holds the draft definition/revision and published revision pointer. `connect_landing_versions` holds immutable snapshots keyed by `(tenant_id, link_id, revision)`. The composite pointer cannot select another QR's snapshot. The app role has SELECT only, restricted to live organizer membership; all writes run through `connect_landing_write`. Snapshot updates/deletes are denied even to the migration owner.

The write function rechecks live membership and owning campaign/link, then serializes on campaign/link locks. It reuses 0028's exact-campaign migration-owner lock policy; no campaign grant is added. Saving requires `campaigns:write`; publishing requires `connect:publish` (owner/admin). A missing state starts at revision zero. Every successful save advances the revision. Save/publish require the exact expected revision and current QR code. Stale edits/rotation and archived parents return 409. Publishing the same current revision returns `unchanged` with no second snapshot/audit. Publishing never changes QR status or expiry; a draft, paused or expired QR stays unavailable.

Under `/api/workspaces/:tenantId/campaigns/:campaignId/connect/links/:linkId`:

| Method/path | Contract |
| --- | --- |
| `GET /landing` | Definition, revision, current expected code, published snapshot and edit/publish permissions; authenticated organizer only |
| `PUT /landing` | Strict `{definition, expectedRevision, expectedCode}`; returns latest editable state |
| `POST /landing/publish` | Strict `{expectedRevision, expectedCode}`; returns latest state and outcome |

All responses, including failures, are private/no-store. Writes verify same origin and bound streamed JSON bodies to 32 KiB. Server and database validate the definition and reject unknown properties. External URL grammar allows only HTTPS ASCII DNS names, optional valid port and path/query/fragment; it rejects credentials, IP literals/alternate IP encodings, localhost/local/internal names, encoded hosts, controls, spaces and backslashes. It does not resolve or fetch destinations or certify their contents; this is a syntax boundary for direct outgoing links.

`resolve_connect_link` is unchanged. New constrained `resolve_connect_landing(kind, code)` derives ownership from the current opaque QR/short code and returns only locale, public title and current published definition. No draft, revision, actor or internal identifier is returned. Both public routes use it per request without cross-request caching, preserving pause/expiry/archive/retired-code unavailability. Resource-only links work without form or intake availability.

## Verification

Validation is in progress. Final command results, screenshot inspection and exact-head independent review will be recorded before PR delivery. Runtime tests use disposable local PostgreSQL and fabricated contacts; browser email uses the existing mock mailbox. No live database, provider send, merge or deployment is involved.
