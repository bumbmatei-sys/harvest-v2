# PR 01b round 2

Date: 2026-11-04. Review: `v2-2-REVIEW.md` at b6d3e00. Founder decisions in the companion PRD override the proposed implementation requirements.

Merged `origin/main` into `feat/pr01b-shell` without rebasing. Main advanced from d136f7b to 5ec4f02 before this round; both are included. The merge brings in the foundation CI workflow and companion PRD without conflicts.

B1: installed RadioGroup, Pagination, Avatar, DropdownMenu, Empty, AlertDialog, InputGroup and Field through the official shadcn CLI. Appearance has one keyboard-operated RadioGroup; contact paging uses Pagination with `aria-current`; the sidebar account follows NavUser with Sign out in DropdownMenu. Contact overview uses Tabs; avatars, notices, sidebar promo, access/empty states, illustration placeholders, form fields and search use the registry primitives. Removed the decorative external-link arrow. Theme previews share the actual token declarations, without duplicate hard-coded colors. The account dropdown is non-modal, allowing the page landmarks to remain available to assistive technology while the menu is open; its portal stays inside the workspace navigation landmark. All of `src/` was scanned for raw controls and hand-built equivalents. Layout and typography remain ordinary composition of shadcn primitives.

## Consent and erasure

Migration 0004 adds `recorded_by`, controlled `purpose` and `notice_version`, and separate `occurred_at` / `recorded_at`. Existing actors and recording times are recovered only from a matching tenant's consent audit event; unavailable provenance remains explicitly legacy/unknown. Occurrence timestamps are preserved; equal occurrence times sort by recording time before the random ID, so a later recorded withdrawal wins a tie. Purpose/version identifiers are allowlisted, so personal information cannot be typed into fields retained after erasure. New inserts verify the recorded actor against the server transaction context.

Owners/admins can erase a contact through the confirmation dialog or authenticated same-origin `POST /api/workspaces/:tenantId/contacts/:contactId/erase` with `{ "confirm": "erase" }`. Membership is checked by the service and again inside the fixed database function. Member/viewer/non-member access fails closed.

Erasure replaces the name with a constant tombstone, clears notes, deletes every identifier and redacts free-text consent source/evidence. Ledger events lose their contact, channel and recorded-actor links and receive new random IDs so historical audit IDs cannot reconnect them. Only workspace-scoped anonymous facts remain: purpose, wording version, consent status and timestamps. Erased contacts disappear from search/list/detail and cannot be edited or receive identifiers/consent again. No contact or consent row is hard deleted. Immutable audits contain no contact content or evidence.

The runtime still has only SELECT/INSERT on consent. There is no flag that enables UPDATE. The security-definer erasure function has a fixed `pg_catalog, pg_temp` search path, fully qualified relations, explicit tenant filters, context/membership checks and a PUBLIC execute revocation. Its owner also has tenant-constrained policies for environments where FORCE RLS applies to the owner. A trigger permits only complete redaction after contact erasure and refuses changes to consent facts; DELETE/TRUNCATE remain blocked. Parent locks serialize erasure with contact/identifier/consent writes. Audit failure rolls back everything. See [PostgreSQL's security-definer guidance](https://www.postgresql.org/docs/17/sql-createfunction.html).

The local test harness handles only the expected Postgres shutdown code after pool closure and records any other pool failure as a sanitized test error, preventing idle-client diagnostics from dumping connection details.

A populated-history upgrade test covers the backfill and removal of temporary migration-owner policies. Erasure tests cover personal values in all existing contact fields and ledger text, anonymous facts, re-identification attempts, unchanged second-workspace records, direct SQL denial, restricted non-superuser owner, append-only facts and atomic rollback.

## Visual references opened before UI edits

All paths below are in [Harvest-agent docs/prd/screenshots on main](https://github.com/bumbmatei-sys/Harvest-agent/tree/main/docs/prd/screenshots). Only layout, spacing and hierarchy inform the implementation; no source, images, logos or text were copied into the product. Tokens follow [DESIGN.md](../design/DESIGN.md).

| Changed screen | Opened reference |
| --- | --- |
| Shared shell, workspace listing and account menu | `03-plans-billing/plans-001-desktop-57-workspace-menu.webp`, `05-communities/comm-072-desktop-81-untitled-profile-menu.webp` |
| Contacts list, search, paging, empty and access states | `06-crm/crm-001-desktop-32-store-customers.webp`, `crm-005-desktop-14-customers-empty.webp` |
| Contact detail overview and marketing preferences | `06-crm/crm-009-desktop-21-clients-active-tab.webp`, `07-events/events-012-desktop-29-events-detail-top.webp` |
| Contact, consent and erasure dialogs | `06-crm/crm-007-desktop-18-customers-add-one-dialog.webp` |
| Appearance | `03-plans-billing/plans-003-desktop-59-settings-preferences.webp` |

The references have no exact consent-ledger or erasure screen; these use their dialog/card vocabulary with original Harvest workflows.

## Validation

Final local results: lint, strict typecheck and production build pass; 20 unit tests, 39 PostgreSQL integration/RLS tests and 2 Chromium journeys pass. Integration/RLS was repeated once after the teardown fix, with zero unhandled errors in both runs. Every database harness applies the migrations twice; the populated-history test additionally upgrades from migration 0003. `drizzle-kit generate` reports no schema changes.

The browser journeys cover keyboard selection of the workspace theme through RadioGroup, saving, reload persistence and local/workspace precedence; next/previous Pagination with 21 persisted contacts and `aria-current`; POST/PATCH rejection of extra `tenantId` (400); non-member 403s for list/detail/create/update/consent/appearance/erasure; viewer denial; mobile navigation; the erase confirmation and resulting missing contact; safe error retry; and zero browser page exceptions. All 42 captured screens pass the unfiltered axe suite, with 1,704 successful rule results and zero violations.

Command output is normalized in [pr01b-checks.txt](pr01b-checks.txt). Screenshots and per-screen axe counts are generated from the real local app under [screenshots/pr01b](../screenshots/pr01b/README.md), using disposable PostgreSQL, real sessions and a mocked mailer.

Neon staging with two seed tenants/roles and founder visual/task sign-off remain release gates from the prior review. No long-lived database is migrated locally. The PR remains unmerged and nothing is deployed; no real email is sent.


## Workspace continuation

The original `.git` mount is read-only. This session's writable Git metadata is `/tmp/harvest-pr01b-round2/.git`, with `/tmp/harvest-pr01b` configured as its working tree. Use `GIT_DIR=/tmp/harvest-pr01b-round2/.git git ...` for local follow-up commands. No force-push was used.

## Changed files

Merged from main: `.github/workflows/ci.yml` and `docs/prd/PRD-v2.7-companion.md`. Round 2 implementation, tests and evidence:

```text
docs/acceptance/pr01b-round2.md
docs/acceptance/pr01b.md
docs/architecture.md
docs/screenshots/pr01b/README.md
docs/screenshots/pr01b/account-menu-studio-dark.png
docs/screenshots/pr01b/appearance-harvest-dark.png
docs/screenshots/pr01b/appearance-harvest-light.png
docs/screenshots/pr01b/appearance-studio-dark.png
docs/screenshots/pr01b/appearance-studio-light.png
docs/screenshots/pr01b/axe-results.json
docs/screenshots/pr01b/consent-dialog-studio-dark.png
docs/screenshots/pr01b/contact-create-error-studio-dark.png
docs/screenshots/pr01b/contact-detail-harvest-dark.png
docs/screenshots/pr01b/contact-detail-harvest-light.png
docs/screenshots/pr01b/contact-detail-mobile-harvest-dark.png
docs/screenshots/pr01b/contact-detail-mobile-harvest-light.png
docs/screenshots/pr01b/contact-detail-mobile-studio-dark.png
docs/screenshots/pr01b/contact-detail-mobile-studio-light.png
docs/screenshots/pr01b/contact-detail-studio-dark.png
docs/screenshots/pr01b/contact-detail-studio-light.png
docs/screenshots/pr01b/contact-erasure-dialog-studio-dark.png
docs/screenshots/pr01b/contact-not-found-studio-dark.png
docs/screenshots/pr01b/contacts-after-erasure-studio-dark.png
docs/screenshots/pr01b/contacts-empty-harvest-dark.png
docs/screenshots/pr01b/contacts-empty-harvest-light.png
docs/screenshots/pr01b/contacts-empty-studio-dark.png
docs/screenshots/pr01b/contacts-empty-studio-light.png
docs/screenshots/pr01b/contacts-list-harvest-dark.png
docs/screenshots/pr01b/contacts-list-harvest-light.png
docs/screenshots/pr01b/contacts-list-mobile-harvest-dark.png
docs/screenshots/pr01b/contacts-list-mobile-harvest-light.png
docs/screenshots/pr01b/contacts-list-mobile-studio-dark.png
docs/screenshots/pr01b/contacts-list-mobile-studio-light.png
docs/screenshots/pr01b/contacts-list-studio-dark.png
docs/screenshots/pr01b/contacts-list-studio-light.png
docs/screenshots/pr01b/contacts-no-results-studio-dark.png
docs/screenshots/pr01b/contacts-pagination-studio-dark.png
docs/screenshots/pr01b/contacts-unauthorized-harvest-dark.png
docs/screenshots/pr01b/contacts-viewer-studio-light.png
docs/screenshots/pr01b/workspace-harvest-dark.png
docs/screenshots/pr01b/workspace-harvest-light.png
docs/screenshots/pr01b/workspace-studio-dark.png
docs/screenshots/pr01b/workspace-studio-light.png
docs/ui-sources.md
drizzle/0004_dry_ezekiel.sql
drizzle/meta/0004_snapshot.json
drizzle/meta/_journal.json
src/app/api/workspaces/[tenantId]/contacts/[contactId]/erase/route.ts
src/app/globals.css
src/app/workspaces/[tenantId]/contacts/[contactId]/page.tsx
src/app/workspaces/[tenantId]/contacts/page.tsx
src/app/workspaces/page.tsx
src/components/access-state.tsx
src/components/app-shell.tsx
src/components/appearance-form.tsx
src/components/consent-form.tsx
src/components/contact-form.tsx
src/components/erase-contact.tsx
src/components/ui/alert-dialog.tsx
src/components/ui/avatar.tsx
src/components/ui/button.tsx
src/components/ui/dropdown-menu.tsx
src/components/ui/empty.tsx
src/components/ui/field.tsx
src/components/ui/input-group.tsx
src/components/ui/pagination.tsx
src/components/ui/radio-group.tsx
src/db/schema.ts
src/lib/contact-input.ts
src/server/contacts.ts
src/server/permissions.ts
tests/database.ts
tests/e2e/foundation.spec.ts
tests/e2e/pr01b.spec.ts
tests/integration/consent-migration.test.ts
tests/integration/contacts.test.ts
tests/integration/erasure.test.ts
tests/unit/consent-input.test.ts
```
