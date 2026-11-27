# Community address lock: permanent from first publish (acceptance record)

Follow-up to the 17 Nov founder decision on the community address field (`docs/decisions/founder-decisions-2026-11.md`) and `docs/acceptance/shell-slice3b.md`. Migration **0128** (`0128_community_address_lock`); 0127 is reserved for open PR #300. Status: draft PR, not independently reviewed, not merged, nothing deployed, no production migration applied.

## What changed

- `communities.first_published_at` (nullable timestamptz): set the first time a community is published, never cleared, including on unpublish and republish.
- Database lock: `public.community_address_lock()` (plain invoker trigger, `BEFORE INSERT OR UPDATE`, pinned `search_path = pg_catalog, pg_temp`, schema-qualified, no `app.*` settings, `EXECUTE` revoked from `PUBLIC`). It stamps the marker when a row becomes published, refuses changing or clearing the marker once set (`23514`, constraint `community_first_published`) and refuses a slug change once set (`23514`, constraint `community_address_locked`), for every role including the superuser. No SECURITY DEFINER function is added or changed.
- Backfill: communities published now, and communities the audit log shows were published before (unpublished or archived since), get their earliest recorded `community.publish` time, else `updated_at`. `communities` and `audit_logs` have FORCE RLS, so the block records which of them have FORCE, sets NO FORCE, runs the update and restores FORCE exactly (the 0091 / 0123 pattern).
- `unsubscribe` is reserved in the database as well as in the app (coordinator request; the static `/communities/unsubscribe` page from #301): added to `reservedCommunitySlugs` and the `community_slug` CHECK. A migration cannot rename a live address, so if a community already uses `unsubscribe` the migration stops with `migration 0128: a community already uses the reserved address "unsubscribe"; rename it by hand before applying this migration` and rolls back.
- App: `updateCommunity` returns 409 `communitySlugLocked` based on `communityAddressLocked()` (marker set, or currently published), and maps the database lock error to the same 409 for a publish that races an edit. The error copy no longer says "Unpublish it first".
- UI (`community-editor.tsx`): the Address field is read-only whenever the address is locked, including an unpublished community that was once published, and stops following the title. One line under it, `Fixed once published, so shared links keep working.` (`FieldDescription`, linked by `aria-describedby`). Reuses the existing `Field`, `InputGroup` and `FieldDescription`; no new kit item.

## Tests

- `tests/integration/community-address-lock.test.ts`: publish sets the marker; unpublish keeps it; republish keeps the first date; slug change refused after first publish via the service (409) and via a direct update as `harvest_app` (and as the superuser); marker cannot be cleared or moved; a never-published draft can change its slug (service and direct); another ministry's draft is unaffected and cannot reach ministry A's rows; a row inserted as published is stamped; `unsubscribe` refused by app and database.
- `tests/integration/community-address-lock-migration.test.ts`: migration-owner (NOBYPASSRLS) fixture with the `beforeCommunityAddressLockMigration` hook (applies journal entries up to idx 127, so it still works once #300's 0127 lands): published, once-published-then-unpublished and never-published seeds; markers as expected; FORCE still on both tables; backfilled addresses locked.
- `tests/integration/community-address-lock-reserved-migration.test.ts`: a pre-existing `unsubscribe` community makes the migration fail with the clear message.
- `tests/unit/community-slug.test.ts`: `communityAddressLocked` and `slugFollowsName` with the marker.
- `tests/e2e/shell-slice3b.spec.ts` address test: after publish, unpublish keeps `firstPublishedAt`, PATCH slug still 409, the field stays read-only with the explanation line at 1280 and 390 in light and dark, title edits do not move it, no horizontal overflow, axe (wcag2a, wcag2aa, wcag21aa) clean.

## Not verified

- Neon migration check (runs from `main` only); production data (whether any live community already uses `unsubscribe`).
- CI on the PR at the time of writing; independent review.
