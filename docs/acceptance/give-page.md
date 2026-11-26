# Public fundraising page (/give/&lt;slug&gt;)

Founder request and decisions (26 Nov 2026, form answers): a public page per fundraiser at `/give/<slug>` (for example `/give/christmas-outreach`) with the
title, description, a cover image, raised / goal / progress live from the gifts the ministry recorded (never donor names), a per-fundraiser switch that hides
the amount, and the ministry's Ways to give block with its Report button. **No public pledge form** ("Not yet": it waits for the privacy decisions).

Record keeping only. Harvest processes no payment, calls no provider, fetches no link and sends nothing. Donation providers remain UNDECIDED; Dodo stays
SaaS billing only. The HC-02 activation gates stay unapproved. The page, its owner section and routes are development-only (`givePageEnabled()` = the
fundraising and Ways to give gates: never when `NODE_ENV`, `VERCEL_ENV` or `HARVEST_ENV` is `production`). A merge is not activation.

## Delivered

- Migration `0124_give_pages` (reserved number; 0121–0123 are held by other open builders and the coordinator renumbers at merge; self-contained;
  journal `idx` 124, `when` after 0120):
  - `fundraising_pages` (one per fundraiser; tenant + fundraiser key and composite FK): `slug` (global unique index; `^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$`,
    the community rule, plus a reserved-word list), `description` (plain text with line breaks, at most 5,000 characters, trimmed, no control characters),
    `cover_file_id`, `show_amount` (default true), `version`, `created_by`, timestamps.
  - `fundraising_files`: the cover, through the scanned-upload steps of campaign and event covers (pending → uploaded → ready or quarantined; key
    `workspaces/<tenant>/fundraising/<fundraiser>/files/<id>`; JPEG/PNG/WebP up to 10 MB). A guard keeps the scan moving forward, only by the uploader.
  - `giving_reports.page` now allows `'give'` as well as `'bio'`.
  - ENABLE + FORCE RLS on both tables; no grant to PUBLIC or the worker role. `harvest_app`: SELECT/INSERT and column-limited UPDATE. Policies use
    `public.giving_can(tenant, 'giving')`, which goes through `public.access_role(...)` (0113): owners and admins, and a collaborator with Giving at manage.
  - A trigger keeps the key, ministry, fundraiser and creator fixed, moves the version by one, **refuses a slug change once the fundraiser has left draft**
    (published, closed or archived), and accepts only a ready, unretired cover of the same fundraiser.
  - Public definers (SECURITY DEFINER, `search_path = pg_catalog, pg_temp`, schema-qualified, EXECUTE revoked from PUBLIC and granted to `harvest_app` only):
    - `give_public_page(slug)` → allow-listed jsonb `{slug, title, description, ministry, hasCover, amount}` only when the fundraiser is **published (open)**
      and Harvest staff have not hidden the ministry's giving details (`giving_hidden`, the CW-10 takedown). `amount` is null when the owner switched it off
      (no goal, raised or currency at all). Never names, pledges, gift rows, ids or dates.
    - `give_public_giving(slug)` → the ministry's enabled giving methods for that public page (`giving_public_methods`, the way `bio_public_giving` does), or NULL.
    - `give_public_cover(slug)` → the ready cover's storage key/name/type for the one-minute signed redirect, or NULL.
    - `give_report_giving(slug, reason, note, visitor)` → `giving_report_record(..., 'give', slug, ...)`: the same reports table, reasons and minute limits as
      link in bio (3 per visitor and ministry, 30 per ministry).
    - Same NULL / `not_found` answer for unknown, draft, closed, archived and hidden pages.
  - Internal (not granted): `give_page_scoped`, `give_scope_clear`, `give_scope_restore`. Owner-role policies (`give_public_definer`) read only what the
    transaction-local flags the definers set themselves name (`app.give_public_slug`, then that page's `app.give_public_tenant` and
    `app.give_public_fundraising`). The entry definers clear the app.* settings any owner-role policy reads on entry and restore them on exit, so nothing is
    left behind and a value the app set beforehand never reaches them (tested).
  - `give_released_raised(tenant, fundraiser)` (SECURITY INVOKER, granted to `harvest_app`): the released raised figure; the public definer calls it under
    its flags, the owner preview under ordinary row security, so the two cannot drift.
- **Raised** = the sum of live gifts the ministry recorded as confirmed (a reversed gift is not live; its replacement is) = the ledger net of reversals (tested
  against the staff total). Pledges never count.
- **Small-group suppression (spec section "public suppressed progress")**: the raised figure (and so the percentage) is released only when no gift is live
  (`0`) or when **at least five distinct identified supporters** gave (a CRM contact through the gift's link or its pledge; repeat gifts from one person count
  once). Gifts without a known supporter (a typed name or nothing) never count toward the cohort. Otherwise the goal shows with "Progress shows once more gifts
  are recorded." The minimum is `connect_retention_policy().small_group_min` (5).
- Server `src/server/give-page.ts`: `getGivePage`, `saveGivePage` (create or versioned update; slug locked after draft; taken slug → 409
  "That address is taken"), cover `createGiveCoverUpload` / `confirmGiveCoverUpload` / `setGiveCover` / `getGiveCoverUrl`, owner `givePagePreview`, public
  `publicGivePage`, `publicGiveMethods`, `publicGiveCover`, `submitGiveReport`. Capability `fundraising:publish` (owner/admin). Audits
  `fundraising.page.create|update|cover` with the version and changed field names only (never the text).
- API (verified session, same origin on writes, private no-store, 404 while off): `GET|PUT /api/workspaces/:id/fundraising/:fid/page`,
  `GET|PUT .../page/cover`, `POST .../page/cover/uploads`, `POST .../page/cover/uploads/:fileId/confirm`.
- Public routes: `/give/[slug]` (server-rendered, `force-dynamic`, `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer` through
  `src/proxy.ts`, OG/Twitter title, description and cover, `noindex`), `/give/[slug]/cover` (302 to a one-minute signed address, `no-store`),
  `POST /give/[slug]/report` (same origin, JSON, 4 KiB, honeypot, hashed visitor key in the minute counters only; 404 for unknown/non-public).
- Owner UI: a **Public page** card on the fundraiser screen (Operations > Giving > Fundraising > a fundraiser), owners and admins only: address (prefilled
  from the title, read-only once open), description, the shared cover picker, the "Show amount raised" switch, Live / Not public yet badge, the copyable
  link, Open page (when live) and a Preview dialog rendered with the public view itself.
- Public UI: `GivePageView` (cover, title, "By {ministry}", description, the progress card, `WaysToGive` with Report, and "Gifts go directly to
  {ministry}. Harvest doesn't process payments."), one column on phones, two from `lg`, inside the shared `PublicFrame`.

## Reuse and exceptions
- Reused: `PublicFrame` and the community public page layout (two columns from `lg`), `WaysToGive` (unchanged, with its Report dialog and honeypot),
  `EventCoverPicker` + `useEventCoverUrl` (one more message namespace), the campaign-cover upload server steps (`inspectCommunityUpload`, scanner,
  `communityUploadReleased`), `Card`, `Progress`, `CopyButton`, `StatusBadge`, `InputGroup`, `Field`, `Switch`, `Dialog`, `giving_report_record`,
  `giving_hidden`, `giving_public_methods`, `bioVisitorKey`, `fundraisingRoute`.
- `GiveProgress` lives next to `FundraisingProgress` (same file, same helpers `formatCents` / `progressPercent`): the staff block shows pledges and gift
  counts that a public page must not, so the public variant is a sibling rather than a flag.
- No new Shadcn UI Kit item and no new kit layout; no approval list needed.

## Evidence
- Integration `tests/integration/give-page.test.ts` (embedded Postgres, restricted migration owner): 10 tests — production guard; slug format, reserved words
  (app and database), normalisation, global uniqueness, versioning, lock after open (service and direct SQL), audit without text; owners/admins only, members,
  viewers and other ministries denied (service and direct SQL); FORCE RLS, table/column grants, definer flags (SECURITY DEFINER, pinned search_path, no
  PUBLIC execute, internal helpers not granted); allow-listed fields; nothing for unknown, draft, closed and staff-hidden pages; no amount when switched
  off; suppression below five identified supporters (unknown and repeat supporters not counted), then raised equal to the staff total and the ledger net of a
  reversal and a corrected gift; no names/pledge/gift ids in public answers; owner preview equal to the public figure; app.* flags restored and preset
  flags ignored; the app role reads nothing through the definer flags; report route (accepted, invalid, 404 unknown/draft/foreign origin, 415, honeypot,
  429 with `Retry-After: 60`, stored as page `give`, no address stored).
- Unit `tests/unit/give-page.test.ts`: 5 tests (reserved list and pattern in step with the migration; slug, suggestion, description and public-shape rules).
- Browser `tests/e2e/give-page.spec.ts`: the owner saves the page, it is 404 while draft, the owner opens the fundraiser (address becomes read-only, Live,
  preview), a signed-out visitor sees title, ministry, description, $3,750.00 and 75% of goal, Ways to give with Report, the notice, OG title, no supporter
  names, private no-store, axe clean with no horizontal scroll at 1280 and 360; Report sends; after the owner switches the amount off the visitor sees no
  progress and no amounts; unknown slug 404.

## Not included
- No public pledge form, no payment, checkout or provider, no donor list, ranking or feed, no indexing (pages are `noindex`), no custom domain.
- No change to the outreach campaign page or the Fundraising list (the address shows on the fundraiser screen only).
- Production stays off; nothing activated.

## Founder decisions needed
1. **Small-total suppression.** Implemented: no raised figure or percentage until at least five distinct identified supporters gave; gifts without a linked
   CRM contact never count toward the five, so a ministry that records many anonymous gifts shows "Progress shows once more gifts are recorded" until five
   linked supporters exist. Alternatives: count unknown gifts as one supporter each, or show coarse rounded totals. A visitor who watches the page over time
   can still infer the size of new gifts once the total is released (the spec leaves update cadence to the privacy review).
2. **Slug changes after publishing.** Implemented: fixed once the fundraiser leaves draft (as for communities). A later "rename with redirect" would need its own
   decision and a redirect table.
3. **Zero before the first gift.** Implemented: shows `0` raised (reveals only that nothing is recorded yet). Alternative: hide progress until the cohort exists.
4. **Indexing.** Implemented: `noindex` for every give page; listing in search engines or Discover would be a separate choice.
5. **Report scope.** The Report button posts to `/give/<slug>/report` for any public give page (also when no giving method is enabled the button is not shown,
   because `WaysToGive` renders nothing without methods).
