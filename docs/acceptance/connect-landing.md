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

## Initial delivery verification

Initial validated application implementation: `6b1b27f7d0408787055c27f1d73c5190a130821e`. The initial delivery at `ac25c38` added evidence/documentation and generated CSS. The non-technical editor follow-up below records the latest application changes; the PR records the latest exact delivery head and delta review. Validation used Node 24.22.1, PostgreSQL 18.6 and local Chromium 156.0.8078.79. Browser email used the existing mock mailbox; no live database or provider was contacted.

| Check | Author result |
| --- | --- |
| `npm run lint`, `npm run typecheck` | Passed on final application source |
| `npm run test -- --reporter=json --outputFile=/tmp/landing-unit-exact.json` | 290 passed, 25 files, zero skipped, on final application head |
| `npm run test:rls -- --reporter=json --outputFile=/tmp/landing-integration-final.json` | 394 passed, 43 files, zero skipped; SQL/service/test source unchanged in final UI-only correction |
| `npm run build` | Passed on final application head (Next 16.4.5, webpack) |
| `CHROME_PATH=/usr/bin/chromium npm run test:pwa` | Passed: installability, accessibility/best-practices 100, offline fallback/static-only cache and axe |
| `npx drizzle-kit check`, `npx drizzle-kit generate --name verify_landing` | Passed; no further schema change to generate |
| Snapshot/journal/whitespace comparison | Existing table metadata and merged migration prefix unchanged; 0030 follows 0029; diff checks passed |
| Connect/auth browser regressions | Combined 23-case run passed; includes two editor cases and 21 existing Connect/auth cases |
| Final `connect-landing.spec.ts` rerun | All 4 passed on final application source in 1.7 minutes, including both history compatibility cases |
| Visual/keyboard/accessibility | 24 clean axe scans and 24 inspected mobile/tablet/desktop light/dark captures; zero document/main overflow; measured controls at least 44 × 44px |

The integration suite covers cross-tenant and forged-parent access, live role downgrade, private drafts, immutable snapshots, stale saves/publishes, duplicate concurrent publication, current-code rotation, link/campaign archive races for both save and publish, expiry without extension, and both public URL kinds. Two dedicated cases apply real migrations under an actual non-superuser/non-BYPASSRLS owner on fresh and populated-0029 databases, replay migrations, preserve two tenants' existing published links and exercise draft/publication/resolution through `harvest_app`. Existing HC-05/07 restricted-owner and consent/claim/withdrawal/erasure cases also pass in the full suite.

The combined browser command selected `connect-landing`, `hc07-invitations`, `hc05-intake`, `hc03-connect-links`, `hc03-responsive`, `connect` and `foundation`. All 23 passed in 7.4 minutes. The later four-case editor run exercises final text wrapping, root bridge order, same-document cancel/save/discard without Navigation API, multi-entry Back and Forward. This is **25 unique browser cases across runs**, not a claim that all 25 ran in one final command. It covers unchecked consent, guest rights, verified claim continuation/mismatch/switch/decline, existing Organization preservation and free no-identity resources. The final application-only corrections are fully covered by the four editor cases; existing regression evidence precedes that UI-only delta.

Reproduction uses the repository browser dependency by default. This environment's package-download policy denied Playwright's CDN, so local runs set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`; the config leaves its normal bundled-browser behavior unchanged when that variable is absent. `LANDING_QA_DIR=docs/screenshots/connect/landing` persists the final captures. [Screenshot index](../screenshots/connect/landing/README.md), [geometry/axe measurements](../screenshots/connect/landing/metrics.json) and [compact validation totals](../screenshots/connect/landing/validation.json), [production Lighthouse](../screenshots/connect/landing/pwa-lighthouse.json) and [offline checks](../screenshots/connect/landing/production-offline.json) are committed. Browser emulation is not physical-device or venue-load certification.

A newly created non-author session independently reviewed the complete implementation and corrections: **MERGE-OK for bounded source scope, no unresolved blocking finding** at `6b1b27f`. [Independent report](../reviews/connect-landing-independent.md) records exact reviewed commits, resolved P2 history gaps and independently executed unit/static/bridge probes. The reviewer did not execute DB/browser/build suites or inspect screenshots; those are author evidence. Runtime exposed Next's synchronous router-listener teardown after initial source review; the final pre-hydration bridge and real compatibility regressions resolve it. Visual QA also corrected back-link contrast and intrinsic long-text wrapping; JSONB key-order dirty comparison and keyboard focus were corrected during author testing.

The fallback for browsers without Navigation API deliberately replaces the forward history branch when a dirty editor is restored. It preserves the mounted draft and the visitor's actual chosen destination before explicit discard; it does not claim exact preservation of the browser stack. No production intake, real invitation send, merge or deployment occurred. All five activation decisions remain unapproved.


## Non-technical organizer follow-up

Matei noted that the original screenshots’ adversarial HTML-like strings looked like something an organizer needed to write. The product never required HTML; the screenshots mixed safety fixtures with the normal walkthrough. The revised walkthrough uses a warm welcome and a readable course title. A separate browser case retains invalid-address and literal-markup/execution coverage without producing product screenshots.

The editor now provides ordinary writing examples, “Website link” and “Cost for visitors” labels, clear guidance for adding Harvest resources or website links, and visible Move up / Move down / Remove actions. The numbered accessible names include those visible phrases for voice navigation. Human-readable private/saved/published states replace internal revision counters; unsaved changes take precedence over saved-version status. Community links explain why their cost remains free. The shared preview still updates as the organizer types; validation, publication, permissions, QR lifecycle and consent behavior are unchanged.

Application follow-up: `1d1da1838b900bb72842f272fd7e9a5d363b0b92`. On that source, the author reran lint, typecheck, production build and all 290 unit tests successfully (zero skipped). All five editor browser cases passed in 1.9 minutes, including separate unsafe-input coverage and both history fallback cases. The run regenerated all 24 screenshots: author inspection confirmed normal readable content, axe scans were clean, document/main overflow was zero and measured controls remained at least 44 × 44px. There are now **26 unique browser cases across runs** (21 existing Connect/auth regressions plus five editor cases), not one 26-case final command.

The existing newly created non-author session independently reviewed both UI follow-up commits and resolved its accessible-name finding; **MERGE-OK at exact application head `1d1da1838b900bb72842f272fd7e9a5d363b0b92`**, with runtime/visual execution still attributed to the author. The PR records the read-only final evidence-delta review. The earlier 394-test integration/RLS result remains applicable to unchanged SQL/service/schema files. No migration or capability was added by this usability refinement.
