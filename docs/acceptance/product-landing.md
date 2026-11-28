# Product and course landing page with reviews

Founder spec of 27 Nov 2026 ("Landing page", section order 1 to 9) and the approved kit items `hero12`, `pricing17`, `feature13`, `customer-reviews5` in `testimonial11`'s grid, `feature9`, `faq7`, `cta2`. Working migration **`0154_product_landing`** (journal index 142, snapshot `0142_snapshot.json`; renumber at merge after whatever merges first, never renumber a merged one). Draft PR: not for merge without independent review and founder approval. No deployment, no checkout, no real outbound message.

Status values: BUILT, DEFERRED (with reason).

## Server

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| S1 | Landing content per course or product (subtitle, long description as the blog's block JSON, what's included, about-the-creator text and photo, FAQ, final quote and button label), public only while the item is published and visible | BUILT | `catalog_landings` (FORCE RLS). Owners and admins edit through `catalog_staff` (withTenant, `catalog:manage`); `saveLanding` validates (`landingInput`, Docs sanitiser for the body, 64 KB), checks the expected version (409 when stale) and audits `catalog.landing`. Public read only through `public.catalog_landing(slug)`, which first calls `catalog_access(slug,'metadata')` (published; listed, unlisted, or hidden only for a member of a community whose shelf shows it). The photo is one of the ministry's ready private images, served by `GET /api/catalog/:slug/photo` through `catalog_landing_photo` (a one-minute signed redirect, 404 otherwise). |
| S2 | Sale price with start and end; valid only if lower than the price and ending in the future; public read returns current price, old price and end; checkout off | BUILT | Table checks (sale needs a price, lower, end after start); `saleProblem` refuses a sale with no price, not lower, ending before it starts or already ended (400 `sale_*`). `catalog_landing` applies the sale only between start and end. A priced item cannot be enrolled through the free flow: `catalog_access('enrol')` is patched in place (0138 style: exact replace, length check, EXECUTE) to answer nothing for it. A price makes the Discover listing paid (`refreshDiscoverListing`). |
| S3 | Reviews by people with an active membership, enrolment or entitlement; once per item, editable; 1 to 5 stars, up to 1,000 characters; owners and admins hide (audited); public read returns visible reviews, average and count | BUILT | `catalog_reviews` (FORCE RLS, PK tenant+item+person). Written only by `catalog_review_save`, which requires an active entitlement for the item (catalogue items grant access through entitlements); an edit keeps a hidden review hidden. The app role has SELECT plus UPDATE of `hidden_at`/`hidden_by` only, and only as staff; hiding audits `catalog.review_hide`/`catalog.review_show` with the reviewer id, never the text. Public: first name only, newest 30, average and count of visible reviews. |
| S4 | Account deletion removes the person's reviews | BUILT | `account_delete()` patched in place to delete the person's reviews and clear them as hider; two `account_erase_*` policies on `catalog_reviews` copy the 0136 erase-token pattern. Integration covers both. |
| S5 | Public stats: "people have it" with small-group masking; module and file counts | BUILT | Active entitlements counted; under 5 returns null ("Fewer than 5 have it"). Modules are sections with a published lesson; lessons and ready files are counted. |
| S6 | DB rules | BUILT | FORCE RLS on both tables; definers pin `search_path`, use only existing flags (`app.catalog_slug`, `app.catalog_tenant`, `app.community_definer_tenant`, all already in `blog_scope_clear()`/`account_self_reset()`, so no new flag) and blank them before returning (asserted); policies for the definer owner are created `TO current_user` (restricted owner suites pass); no worker grants (asserted). |

## Owner editing

"Sales page" step in the existing editor (`CatalogEditor` in `EditorShell`; step between Access and Publish; disabled until the draft exists). `SalesPageEditor`: `FormSection`s for the page (subtitle, long description in the blog's `DocEditorSurface`, what's included rows), About the creator (heading, bio, photo from the ministry's ready images), Questions, Final call to action, Price (amount, currency, sale amount, start, end; a short "Checkout opens soon" note), its own Save with the landing version, and Reviews with Hide or Show. Saved independently of the draft, so a published item's page can change.

## Public page

`/courses/:slug` and `/products/:slug` (existing routes) render, in the founder's order: creator bar with Sign in (`PublicFrame` header slot), hero, long sales text, buy box (right column, sticky on desktop; after the text on phones), what's included, reviews (with the caller's review form when they have the item), about the creator, questions, final call to action, footer (creator and Sold by, `PublicFrame` footer slot). Free items keep the existing enrol or get step; enrolled learners see progress or files as before.

## Verification (author-executed, synthetic data)

| Check | Result |
| --- | --- |
| lint (ESLint and source guards), typecheck | Passed |
| Unit, full | 172 files passed before the new file; `tests/unit/catalog-landing.test.ts` 4 passed |
| Integration `tests/integration/catalog-landing.test.ts` | 7 passed: wrong ministry, member, foreign owner refused; unpublished and unknown items not public; sale not lower, without price, ended refused; expired and future sales not applied; priced item not enrollable; non-member review refused; small-group masking; hidden review not shown and audited; flags blank; worker cannot execute; account deletion removes reviews |
| Regressions | free-catalog, blog (`blog_scope_clear` flag guard), your-data-export (`account_self_reset` flag guard), your-data-delete, worker-role, worker-role-owner, hc02/hc03 definer-owner, discover-server, community-c23-hardening, community-shelf, migrations: passed |
| E2E `tests/e2e/product-landing.spec.ts` | Passed: Sales page editing and validation, public free and priced pages, enrol, review through the form, non-member refused, priced enrolment refused, owner hides a review; axe WCAG 2.2 AA, no sideways scroll, 44px targets at 390 |
| E2E `tests/e2e/courses-products-public.spec.ts` | Passed (one run of the first case hit a file-confirm timeout on the shared machine; it passed on rerun) |

Screenshots (`docs/screenshots/product-landing/`, deviceScaleFactor 2, 390 and 1440, light and dark): `editor-*`, `course-free-*`, `course-paid-*`.

## Deferred

1. **Terms and Privacy links** in the footer: Harvest has no public Terms or Privacy page yet; the footer shows the creator and Sold by only.
2. **Cover image**: no course or product cover exists on main (#329 adds covers, not merged); the hero shows the course or download art.
3. **Photo upload inside the step**: the photo is chosen from the ministry's ready images (Files); uploading from the step itself is not added.
4. **Paid checkout** stays off until the LLC (founder). Discount codes are a disabled link only.
5. **Your-data export** does not include the person's reviews yet.
6. **Featured review** is the newest visible review with text (no owner choice).
7. The sale countdown here (`sale-countdown.tsx`) and Discover's `sale-line.tsx` (#338) share `timeLeft`; unify when both merge.
8. The shared `globals.css` line `@source not "../../docs"` is also in #338 (identical), so e2e screenshots do not reload dev pages.

## Founder approval (visuals)
The founder saw the landing page and editor screenshots (390 and 1440, light and dark) and approved them for merge on 28 Nov 2026 ("Yes looks for merge to main", about 00:40 Berlin; "Yes the screens are looking good", morning of 28 Nov). Kit items approved 27 Nov.
