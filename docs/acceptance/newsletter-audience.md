# Newsletter Audience screen

Public > Newsletter > Audience (`/workspaces/[tenantId]/newsletter/audience`, nav id `newsletterAudience`, feature `newsletter`, permission `newsletter:read`, live only outside production like the other newsletter routes). Sending stays hard-off; nothing here sends, schedules or calls a provider. All five HC-02 gates remain UNAPPROVED.

## Model

Audience is a newsletter lens over CRM people, not a contact list. There is no new person table. Each person's status is derived, never stored:

- Subscribed: the consent ledger holds an effective newsletter email grant (`consentState`, the SQL twin of the send-time `mayContact` gate) and the person is subscribed on at least one live list.
- Not on a list: grant on record, no list yet.
- Unsubscribed: withdrawal on record (do not contact always wins, at once), or only unsubscribed list rows.
- No consent yet: no decision recorded. Never inferred.
- Bounced or suppressed: the NL-01 global suppress flag, or a bounced or suppressed list row.

## Done

- Status strip with exact counts (ministry wide), lists with subscribed counts, saved groups. Each is a route (`/audience`, `/audience/<status>`, `/audience/list/<id>`, `/audience/group/<id>`), so the shared list state keeps its own filters when the lens is fixed by the path.
- The list itself is the shared CRM `ListPage`, `RecordGrid`, filter popover, search, sort, columns, saved views and paging. `listContacts` gained a `ListExtension` (extra predicate, extra columns) so the lens runs the same predicate, count and paging as CRM People; `personRows` was extracted from the People page so a person renders the same in both. `ListPage` got `basePath`, `eyebrow`, `lens` and `toolbarExtra` slots. `RecordGrid` cells gained a generic request `action` (icon button, one request, refresh).
- Lists: create (a default audience is created on first use), rename (version checked, names unique ignoring case among live lists), delete (hides the list from the Send step, the editor and recipient resolution; memberships and consent history are kept; refused while a reviewed, scheduled or sending email uses it), add people (one at a time through the shared record picker), remove from this list (records an unsubscribe on that list only).
- Adding is subscribe-only-with-consent: the same `mayContact` decision as sending. A person without a recorded grant is reported "No recorded newsletter consent" and not changed. Suppressed or bounced people are refused.
- Saved groups can be renamed and deleted from their chips (see "Saved group rename and delete" below).
- Saved group from the current filter: stores the filter as a shared CRM person view and pins it as an NL-01 segment (source rules refused, as the existing segment API does). It then appears in the Send step.
- Permissions: owners, admins and members read (`newsletter:read`); owners and admins manage (`newsletter:manage`); viewers and other ministries see nothing (404 or the no-access note).
- Import links to the existing CRM import. No new importer, no new exporter.
- Navigation: entry live; `campaigns` (CRM) is not matched on any `/newsletter/*` route (unit test and e2e).

## Server

- Migration `0085_newsletter_audience`: one nullable column, `newsletter_lists.archived_at`. Existing FORCE RLS, grants (select, insert, update only) and the list version trigger apply unchanged; no new table, function, grant or foreign key, so erase and merge are untouched (tests prove subscribers and memberships still clean up). Journal `when` is above 0084, snapshot `prevId` is the 0084 snapshot, a second `drizzle-kit generate` reports no changes.
- `src/server/newsletter-audience.ts`; routes under `/api/workspaces/[tenantId]/newsletter/audience/{lists,lists/[listId],lists/[listId]/people,groups}`.
- Archived lists are excluded from `selectionPins` and `pageNewsletterConfiguration('lists')`.

## Deferred, hard-off, not in this PR

- Sign-up forms and sender or domain setup (later slices).
- Adding many people at once ("add everyone matching this filter") and a bulk remove.
- Export of the lens: the CRM People export does not know the lens status (status is derived, not a CRM filter). Use CRM People with the Newsletter filter for an export that matches.
- Multiple audiences: the screen uses the earliest audience of the ministry; the API still allows several.

## Server gaps and notes

- Renaming a list bumps its version by design (database trigger), which invalidates a pending review that pinned the old version; that is the safe direction.
- "Delete" archives. There is no hard delete grant, on purpose (consent evidence).
- Status counts run one aggregate query over the ministry's people; fine at current sizes, would want a materialized count for very large ministries.

## Reuse and provenance

Reuses ListPage, RecordGrid, ListToolbar, ViewMenu, FilterBuilder, RecordPicker, ConfirmDialog, Dialog, DropdownMenu, Badge, shared shadcn components. No kit code copied, so `ui-provenance.ts`, `docs/ui-sources.md` and `scripts/ui-identical.sh` are unchanged.

## Evidence

Unit: `tests/unit/navigation.test.ts` (live entry, CRM Campaigns never matches newsletter routes). Integration (restricted migration owner): `tests/integration/newsletter-audience.test.ts` (status derivation, no inferred grants, do-not-contact, shared predicates and saved groups, list create, rename, delete, stale and role rules, remove from one list, suppressed, erase and merge cleanup, new column). E2E: `tests/e2e/newsletter-audience.spec.ts` with axe, no horizontal scroll and screenshots at 360, 768 and 1280, light and dark, in `docs/screenshots/newsletter-audience/`; `settings-popup.spec.ts` lists the Audience link.

## Saved group rename and delete (follow-up PR)

- Rename: owners and admins, from the chip menu. It renames the NL-01 saved group and the shared CRM view it points to in one transaction. The view version moves with the name and the group's pinned version follows, so a campaign that pinned the old version no longer matches at review and must be reviewed again (`SELECTION_CHANGED`); nothing goes out on a stale pin. Names are unique among live groups, ignoring case. A stale form is a 409.
- Delete = archive, as for lists: new nullable `newsletter_segments.archived_at` (migration `0086_newsletter_group_archive`, no other schema; existing FORCE RLS, grants and guard trigger apply, no new function or foreign key, so erase and merge are untouched). An archived group disappears from the Audience chips, the Send step (`pageNewsletterConfiguration`) and recipient resolution (`selectionPins`). It is refused (409) while a reviewed, scheduled or sending email pins it. The shared CRM view and all consent history stay.
- Members read, viewers see nothing, other ministries see nothing; only owners and admins write (`newsletter:manage`).
- Known edge (kept on purpose): if the shared view is edited in CRM People after the group was saved, the group is stuck. Rename and archive answer a clear 409 ("This group's filter changed in People, so it can't be changed here. Create it again."), never a 500. It stays inert (its pin no longer matches, so it cannot be sent to); recreate it. A deleted shared view removes the group with it. The segment guard is unchanged and migration 0086 is the single nullable column.
- Names: group names are capped at 60 characters and trimmed (they also name the shared view, whose database check allows 1 to 60); longer names are a 400 validation error, not a database error. Lists keep 100.
- Evidence: integration test in `tests/integration/newsletter-audience.test.ts` (rename versions and pins, names, roles, tenants, in-use refusal, hidden everywhere, new column); e2e rename and delete with axe at 360, 768 and 1280, light and dark (new `groups-*` screenshots).
