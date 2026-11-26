# Communities C13 Classroom and C16 Products shelf

Migration 0121 (`0121_community_shelf`) adds two SELECT policies for `harvest_app` and nothing else: no table, no column, no definer and no session flag. `community_shelf_member` lets a caller read the shelf links of a community they can read (`public.community_can_read`, the forum's test: active membership with a valid grant, or a community host role). `catalog_community_shelf` lets them read the published, listed or unlisted catalogue items on such a shelf. Drafts, hidden and archived items, unlinked items and other communities' links stay invisible.

A shelf link is a pointer to the canonical catalogue item (PRD 7.2, free courses and products design section 2). It grants nothing. Members enrol through the existing free enrolment (`public.catalog_access`), so access follows the existing course and product rules, and a separate enrolment survives an unlink or leaving the community. No `community_included` grant is created (see founder decisions).

| # | Requirement (PRD C13, C16, 5.1, 5.2, 6.4, 7.1, 7.4) | Delivered | State |
| --- | --- | --- | --- |
| 1 | Owner chooses which existing courses appear in the community (C13) | Community editor step "Classroom and products" (was "Coming soon"), Classroom card: one switch per published course, saved at once through the existing `PUT/DELETE /api/workspaces/{tenantId}/communities/{communityId}/catalog/{itemId}` | Done |
| 2 | Owner chooses which existing free products appear (C16) | Same step, Products card, published downloads | Done |
| 3 | No duplicate courses or products | Items stay in Courses and Products; the step lists them via `listCommunityShelf` and links to "New course" or "New product" when none are published | Done |
| 4 | Changing the shelf needs catalogue rights | Switches are disabled without `catalog:manage`; the server refuses as before (catalogue staff policy) | Done |
| 5 | Member Classroom tab (`/communities/{slug}/classroom`) | `communityShelf(..., "course")`, Discover `ListingCard` per course with Details plus "Enrol for free", then Continue (lessons) and an Enrolled badge | Done |
| 6 | Member Products tab (`/communities/{slug}/products`) | Same for downloads: "Get for free", then Open and a Yours badge | Done |
| 7 | Access follows the canonical rules; linking is not access | Enrol and content go through `catalog_access`; integration tests show a member cannot open a linked course before enrolling | Done |
| 8 | Non-members and other ministries see nothing | Tabs redirect to the public page; `communityShelf` is null; raw SQL returns no rows | Done |
| 9 | Hide purchase CTAs; no fake selling (7.4) | Free only; no price, checkout or paid wording | Done |
| 10 | Included / Unlocked by tier / For sale / Coming soon states, member sections "Your purchases", "Recommended next", feature, announce, member preview, ordering | Need tiers, commerce (C17, C18) and a founder decision | Not included |
| 11 | Learning progress (C13 title) | The course learner shows the learner's place; completion needs its own server slice | Not included |

## Reuse and exceptions

- Reused: `EditorShell` steps (the existing `products` step), `Card`, `Switch` rows in the same pattern as the catalogue editor's Community shelf, `EmptyState`, Discover `ListingCard`, `EnrolButton`, `CommunityShell`.
- `ListingCard` gained optional `onQuickLook`, `onReport`, `status` and `action`; an empty host line is left out. Discover is unchanged.
- `EnrolButton` gained an optional `ariaLabel` so several buttons on one page name their item.
- `CommunityShell` gained a Classroom entry and a live Products entry behind `shelf` (the free catalogue gate). The phone bottom bar keeps every entry at least 44px and scrolls sideways inside the bar on the narrowest phones instead of shrinking them.
- No new kit item.

## Evidence

- `tests/integration/community-shelf.test.ts`: owner list and links, viewer read-only, cross-ministry refusal, member classroom and products, enrolment state, raw SQL limits, policy roles, archive, unlink and leaving.
- `tests/e2e/community-shelf.spec.ts`: owner switches, outsider redirect, member enrol from both tabs, Continue and Open, unlink, axe at phone, tablet and desktop in light and dark, no sideways page scroll, 44px bottom-bar targets. Screenshots in `docs/screenshots/communities-c13-c16/`.
- Updated `community-editor.spec.ts` and `shell-slice3a.spec.ts`: Products is no longer a "Coming soon" step.

The free catalogue gate keeps everything off in production. The hosted migration has not been run. All five HC-02 gates remain **UNAPPROVED**.

## Founder decisions needed

1. **Included access.** Should community members get the shelf items automatically (a conditional `community_included` grant that ends with the membership), or is the one-click free enrolment enough for launch? Today it is the enrolment.
2. **Hidden items.** Should a ministry be able to put a `hidden` course on a members-only shelf? Today only listed and unlisted published items can be shown.
3. **Ordering and featuring.** The server stores a position, but the step has no reorder or "Feature" control yet.
