# Communities C13 Classroom and C16 Products shelf

Migration **0123** (`0123_community_shelf`; renumbered from 0121 for the coordinator's sequence, chained after 0120 until 0122 merges). Founder decisions of 26 Nov are applied:

1. **Access:** one-click free enrolment, as built. A shelf link grants nothing. Members enrol through the canonical `public.catalog_access`, so access follows the existing course and product rules.
2. **Hidden items on members-only shelves:** a hidden course or product may now be published. The `catalog_item_publication` check is dropped, and the publish checklist no longer asks for a visibility other than hidden. Such an item is seen only through the shelves of published communities of its own ministry, by their members. `catalog_access` resolves a hidden item (metadata, enrolment, content, files) only for a signed-in caller who can read such a community. It stays invisible to signed-out visitors, non-members, other ministries, Discover (which lists only `listed` items) and public pages. If it is removed from every shelf, even an enrolled member loses it.
3. **Order and featured item:** owners move shelf items up and down (44px buttons, keyboard reachable) and mark one item per shelf as Featured. Members see it first with a badge. The order is stored in `community_product_links.position`. The new `featured` flag is limited to one per community and shelf by the partial unique index `community_product_featured (tenant_id, community_id, kind) WHERE featured`. The new `kind` column is backfilled and tied to the item's own kind by a foreign key to `catalog_items (tenant_id, id, kind)`. No drag: the catalogue's own order controls (lessons, files) use the same up/down pattern.

## Database (0123)

- `community_product_links`: `kind` (backfilled with FORCE row security lifted on both tables for that block only and restored as found, the 0091 pattern, so a NOBYPASSRLS owner reaches every row; `community-shelf-upgrade.test.ts` seeds a link before 0123 as the migration owner and fails without this; NOT NULL, foreign key to the item's kind), `featured` (default false), and the partial unique index.
- `catalog_items`: drop `catalog_item_publication`.
- `harvest_app` SELECT policies:
  - `community_shelf_member` on links: `community_can_read` and the community is published.
  - `catalog_community_shelf` on items: published items on such a shelf, hidden ones included.
- Definer-owner policy `catalog_resolver_shelf` on links, keyed on `app.catalog_tenant`, which the definer sets itself.
- `catalog_access` is replaced with the hidden-item path. It clears `app.catalog_tenant` and the community definer settings (`community_definer_reset`) on entry and on exit. A test shows that pre-set values do not open it. `SET search_path` is pinned and every name is schema-qualified. No `role_id` test.

## Routes

- `PUT/DELETE /api/workspaces/{tenantId}/communities/{communityId}/catalog/{itemId}`: link and unlink, as before. The link now records the item's kind.
- `PUT /api/workspaces/{tenantId}/communities/{communityId}/catalog`: new. Body `{ kind, order: [itemId...], featured: itemId | null }`. `order` must name exactly the linked items of that shelf, and `featured` must be one of them. Otherwise it returns 409; a viewer or another ministry gets 404. The change is audited as `catalog.arrange`.

## Acceptance

| # | Requirement | Delivered | State |
| --- | --- | --- | --- |
| 1 | Owner chooses existing courses (C13) and free products (C16) | Community editor step "Classroom and products": one switch per published item | Done |
| 2 | Owner orders the shelf and features one item | Move up and Move down, and a Feature toggle (`aria-pressed`). The featured item leads and cannot be moved | Done |
| 3 | Members see Classroom and Products tabs | `/communities/{slug}/classroom` and `/products`: Discover `ListingCard`, Featured badge first, then free enrol, Continue or Open | Done |
| 4 | Hidden items only through the shelf | Policy plus definer path. Tests cover signed-out, non-member, other ministry, ministry viewer, Discover, catalogue list, a pre-set setting, and unlink | Done |
| 5 | No duplicate courses or products; linking is not access | Canonical items and links; content needs the person's own enrolment | Done |
| 6 | Tiers, selling, Included / For sale states, "Your purchases", member preview | Need C17/C18 and decisions | Not included |
| 7 | Learning-progress completion | Needs its own server slice | Not included |

## Reuse and exceptions

- Reused: `EditorShell` step, `Card`, `Switch` rows, the catalogue's up/down order buttons and `move`, `EmptyState`, `Badge`, Discover `ListingCard` (optional Quick look and Report, `status` and `action` slots), `EnrolButton` (optional `ariaLabel`), `CommunityShell`.
- Phone bottom bar: every entry keeps a 44px target and the bar scrolls sideways inside itself on the narrowest phones.
- No new kit item.

## Evidence

- `tests/integration/community-shelf.test.ts`, 6 tests:
  - owner list and links, viewer read-only, cross-ministry refusal
  - member classroom and products, enrolment state
  - raw SQL limits and policy roles
  - archive, unlink and leaving
  - hidden items only through the shelf
  - order, featured, and the one-featured and kind constraints
- `free-catalog.test.ts` is updated for the link `kind`.
- `tests/e2e/community-shelf.spec.ts` covers:
  - owner switches, order, feature
  - outsider redirect, and the hidden course returning 404 to an outsider
  - member Classroom (Featured first) and Products, enrolment, unlink
  - axe at phone, tablet and desktop in light and dark, no sideways scroll, 44px bar
- `community-editor.spec.ts`, `shell-slice3a.spec.ts` and `courses-products-screens.spec.ts` are updated: Products is no longer a "Coming soon" step, and hidden can be published.
- Earlier local browser runs on a heavily loaded shared machine: `shell-slice3a.spec.ts` 6 passed, 1 skipped. `community-editor.spec.ts` passed every assertion up to a dev-mode console error at the end. `community-shelf.spec.ts` passed through the owner step, the Classroom checks and enrolment, but not the full spec. CI must confirm the full spec.

The free catalogue gate keeps all of this off in production. The hosted migration has not been run. All five HC-02 gates remain **UNAPPROVED**.
