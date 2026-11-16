# Kit PR 7 — Communities screens polish: acceptance record

Plan: `docs/plans/shadcnuikit-adoption.md` section 7, row PR 7 ("Done when": existing community specs pass with cross-tenant and role checks; moderation, member and Discover screens use the shared pieces from PRs 3 and 4). Presentation only: **no migration, no change to server contracts, RLS, permissions, tenant scoping, moderation rules or consent**. No route changed (public pages stay under `/communities/:slug`, owner pages under `/workspaces/[tenantId]/...`, navigation registry untouched).

**Approves nothing.** Production activation gates are unchanged (`docs/decisions/hc-02-activation-gates.md`). These screens send no message and no webhook.

## Founder approval (gate, section 2)

Approved 2026-11-16 (visual reference only; the founder owns the licence and public-repository consequences). Recorded in `src/lib/ui-provenance.ts` and `docs/ui-sources.md`. All five items are in the registry listing (`social-media-post1` is present, so it was used). Registry JSON was fetched with plain `curl` (no `Authorization` header; the network proxy supplies the credential) into the session scratch directory, never the repository. **No kit code was copied**; the kit's `@tanstack/react-table`, `react-hook-form`, `zod` 3, remote images and sample data are not used. No token was printed, stored or committed.

| Area | Kit item | Decision | Harvest pieces kept |
| --- | --- | --- | --- |
| Member list with roles | `tables9` (alt `tables5` not chosen) | Visual reference only | `DataTable` shell, `StatusBadge`, `EmptyState`, `Avatar` |
| Moderation queue | `tables14` (already recorded for PR 3; second file added) | Visual reference only | `DataTable` shell, existing sheets, dialogs and server calls |
| Creation form | `form-layout11` (alt `form-layout15` not chosen) | Visual reference only | existing dialog, `Field`, `InputGroup`, `FormSection`, editor save semantics |
| Discover cards | `product-list7` (alt `product-list1` not chosen) | Visual reference only | server-side filters in the URL, `EmptyState` |
| Feed cards | `social-media-post1` (alt `chat-ui3` not chosen) | Visual reference only | existing `LikeButton`, report and edit controls |

Design comes from the existing Communities IA (Eden reference screens, read-only; no Eden image, branding or copy used); style from Studio Admin through the shared components. Eden's Discover feed was not used.

## What changed

| Screen | Where | Change |
| --- | --- | --- |
| Owner member list | editor "People" step (`community-editor.tsx`) | `MemberList` (new, `src/components/communities/member-list.tsx`): avatar mark, name, role badge, status badge, status tabs with counts, name search, phone cards. The status badge moves under the name in a narrow container. |
| Public member list | `/communities/:slug/members` | Same `MemberList` (names, roles, joined date, report action), full width, phone cards. No status shown, as before. |
| Moderation queue | `/communities/:slug/moderation` (`moderation-panel.tsx`) | All five tables (reports, held, members, appeals, history) on the `DataTable` shell: phone cards, avatar marks in the members tab, report-type tabs (all, posts, replies, people) and appeal-state tabs (all, open, resolved), `EmptyState`s. Review sheets, dialogs, menus, requests and role checks are unchanged. |
| New community form | communities list dialog | Address field with a visible `/communities/` prefix; same suggestion rule, same request. |
| Community details | editor "Basics" step | Fields grouped in a `FormSection` ("Community details"). |
| Discover | `/discover` | `DiscoverCard` (new): initials band, name, tagline, host, free and open badges, View link; type switcher as a segmented control; shared `EmptyState`. |
| Feed | `/communities/:slug/forum` | `PostCard` (new, `src/components/forum/post-card.tsx`): author header, badges, optional cover, excerpt, footer with replies and likes; shared `EmptyState`. |
| Showcase | `/dev/ui#communities` | New entry with member list, Discover cards and a feed card (synthetic, likes off, no requests). |

Pure helpers (`src/lib/community-members.ts`): initials, name filter, status tabs, status tones.

## Deviations from the kit items (and why)

- No cover dropzone, visibility picker, topic or invite fields in the creation form: the create API takes only a name and an address and no cover upload exists.
- No "featured" switch, channels, reputation or trend in the member list: no server contract or data.
- No row selection or bulk actions in the moderation queue: no bulk moderation endpoint exists and none was added (the `DataTable` supports selection; it is simply not switched on).
- Discover cards have no photo or price: the sanitized Discover projection has neither, so the band shows the community's initials.
- Feed cards have no share, save or edit menu: those actions do not exist; like, report and edit keep their current controls.
- Discover "Courses" and "Products" stay "Coming soon" (unchanged; not part of this PR).

## Behaviour notes

- Crossing the 768px breakpoint swaps a table for cards, which remounts the rows. An open per-row dialog on the public member list (report) closes when the window is resized across that width. The existing `community-moderation` spec resizes mid-flow, so it now reopens the dialog if needed.
- The reports type tab for member reports is named "People" so its name does not collide with the "Members" section tab.

## Tests

- Unit: `tests/unit/community-members.test.ts` (new); provenance and showcase registries validate the new records, headers and consumers.
- E2E `tests/e2e/kit-pr7-communities.spec.ts` (new): owner member list (roles, status, search, empty search, phone cards, 44px tabs), details form, creation form, moderation queue (type tabs, members tab, phone cards, empty appeals), public member list (report action only on others, no status column), feed cards, Discover cards and the empty search, and the role matrix (owner, admin, viewer, member, non-member, other-ministry owner). Axe (wcag2a, wcag2aa, wcag21aa) and no horizontal overflow at 360, 390, 768, 1280 and 1440 in light and dark on each screen.
- Existing specs extended, not rewritten: `community-moderation` (reopen the dialog after a resize) and `ui-showcase` (the whole-page audit waits for the member list to reach its phone layout after hydration).
- Screenshots: `docs/screenshots/kit-pr7/` at 360 and 1280, light and dark. Note: full-page captures of the editor do not include the inner scroll area of the shell, so the owner member list capture shows the top of the step; the list itself is asserted by the spec.

## Verification (run locally, 16 Nov 2026, Chromium, one worker, local PostgreSQL through `TEST_DATABASE_URL`, `HARVEST_UI_SHOWCASE=1`)

`kit-pr7-communities` passes; `community-editor`, `community-forum`, `community-moderation`, `community-moderation-b`, `community-joining`, `community-applications`, `community-notifications` and the `ui-showcase` tests pass. Unit project: 65 files, 908 tests pass. `npx tsc --noEmit`, `npx tsx scripts/check-source.ts`, eslint on every changed `.ts` and `.tsx` file and `npm run build` pass. No dependency changed.

## Not verified

- No independent (fresh-session) review yet; runtime and visual evidence is author-executed.
- Not run locally: the full e2e suite, `crm*`, `connect*` and `campaigns` specs (no navigation or CRM code changed; `tests/e2e` has no navigation link counts that this PR touches), the integration (RLS) project and the Neon migration check (no migration).
- Screen reader behaviour was not tested manually; keyboard operation is covered by the shared pieces' existing tests only.
- The public member list was only exercised with three members; long lists and paging do not exist on that page.

## Founder decisions needed

- Whether the Discover cards should get a real cover image (needs a cover upload and a field in the Discover projection, a server change).
- Whether the creation form should gain visibility, cover and topic (needs API fields), and whether the moderation queue needs bulk actions (needs a bulk endpoint).
- Approval or a different alternate for the unused alternates (`tables5`, `form-layout15`, `product-list1`, `chat-ui3`) is not needed; they are recorded as "not chosen".
