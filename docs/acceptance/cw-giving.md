# CW-10 — Ways to give

Founder decision (26 Nov 2026): until a donation provider is chosen, people give through the ministry's own giving accounts (PayPal, Wise, Venmo, Zelle,
Revolut, Cash App, bank transfer/IBAN, other links) and an admin updates fundraising totals by hand. The link in bio shows these ways to give.
Dodo stays SaaS billing only; donation providers remain UNDECIDED. Harvest integrates no provider API, fetches/previews/follows no link, receives no
webhook and processes no payment.

## Delivered
- Migration `0119_ways_to_give` (tentative number; the coordinator renumbers at merge; self-contained):
  - table `giving_methods` (tenant, ordered `position`, `kind`, `label`, `url` | `handle` | `iban`/`bic`/`account_holder`, `note`, `enabled`, `version`,
    `created_by`). Check constraints repeat the per-kind shape, https-only links without userinfo or port, BIC shape and the IBAN mod-97 check
    (`public.giving_iban_valid`).
  - RLS enabled and forced. `harvest_app` policies for owners/admins through `public.access_role(..., 'giving', ...)` (0113 guard; collaborator with Giving at
    manage counts as admin). Column-limited UPDATE grant; worker role revoked.
  - `public.giving_public_methods(tenant)` (SECURITY DEFINER): enabled methods only, explicit field allow-list, through an owner-only policy on a
    transaction-local setting (`harvest_app` setting it reads nothing).
  - `public.bio_public_giving(handle)` (SECURITY DEFINER): methods only for a published link-in-bio page with a shown Ways to give block; NULL otherwise.
- Pure library `src/lib/ways-to-give.ts`: kinds, exact-host allow-lists for every link kind (no free "other link" kind; never IP literals or ports),
  handle rules (Venmo/Revolut `@name`, Cash App `$tag`, Zelle email or phone), IBAN checksum and formatting, BIC, input schema with per-field issues,
  re-validation of what the database returns.
- Server `src/server/ways-to-give.ts`: list, create (limit 20, advisory lock), update (version check), delete, reorder; every change audited
  (`giving.method.create|update|delete|reorder`) with kind and changed field names only, never account numbers or handles. Public reads
  `publicGivingMethodsFor(db, tenant)` (for embedding pages such as the campaign fundraising page) and `bioGivingMethods(db, handle)`.
- Capability `giving:manage` (area Giving; owner/admin). Navigation entry `waysToGive` under Operations > Giving (`/giving/ways-to-give`), feature
  `giving`, dev-only gate `waysToGiveEnabled()` (never in production, same as link in bio).
- API: `GET|POST /api/workspaces/:id/giving/methods`, `PATCH|DELETE .../methods/:methodId`, `PUT .../methods/order` (verified session, same origin on writes,
  16 KiB body limit, 404 while off).
- UI: management screen (list with show/hide switch, move up/down, edit, remove; dialog form with SearchableSelect for the type; live preview of what
  visitors see) and the reusable public block `WaysToGive` (copy buttons for IBAN/BIC/holder/handle/reference, links open in a new tab with
  `rel="noopener noreferrer"`, note "Gifts go directly to {ministry}."). Link in bio: new optional block "Ways to give" (one per page, heading editable,
  manage link), rendered on the public page and in the editor preview.

## Approved giving platforms (founder decision 26 Nov)
Every link is validated to the exact hosts below (https, no login part, no port, no IP literal). There is no free "any link" kind; the database refuses
`other`. **GoFundMe and Donorbox are TEMPORARY.** They are removed by the PR that adds a payment provider for donations (Stripe or another), with founder
sign-off on that PR: that PR deletes them from `givingPlatformHosts` in `src/lib/ways-to-give.ts`, from the kind check and `giving_url_allowed` in a new
migration (existing GoFundMe/Donorbox rows are turned off or migrated first), and from the messages. Noted next to the list in code, in the database function
and in `docs/decisions/founder-decisions-2026-11.md`.

| Kind | Hosts |
|---|---|
| PayPal | paypal.me, www.paypal.me, paypal.com, www.paypal.com |
| Wise | wise.com, www.wise.com |
| Venmo (link or @username) | venmo.com, www.venmo.com, account.venmo.com |
| Revolut (link or @username) | revolut.me |
| Cash App (link or $cashtag) | cash.app |
| Zelle | email or phone only, no link |
| Bank transfer | IBAN (mod 97), optional BIC, account holder; no link |
| GoFundMe (temporary) | gofundme.com, www.gofundme.com, gofund.me |
| Donorbox (temporary) | donorbox.org, www.donorbox.org |
| Givebutter | givebutter.com, www.givebutter.com |
| Tithe.ly | tithe.ly, www.tithe.ly, give.tithe.ly |
| Pushpay | pushpay.com, www.pushpay.com |
| Planning Center Giving | one ministry subdomain of churchcenter.com (`<name>.churchcenter.com`, not `www`, no deeper nesting) |
| Subsplash Giving | subsplash.com, www.subsplash.com |
| Givelify | givelify.com, www.givelify.com, giving.givelify.com |
| Zeffy | zeffy.com, www.zeffy.com |
| Every.org | every.org, www.every.org |
| JustGiving | justgiving.com, www.justgiving.com |
| Patreon | patreon.com, www.patreon.com |
| Ko-fi | ko-fi.com, www.ko-fi.com |
| Buy Me a Coffee | buymeacoffee.com, www.buymeacoffee.com |

The exact hosts are enforced three times: by the server on every write, by the database (`giving_url_allowed(kind, url)`, an IMMUTABLE check like the
IBAN one; a unit test keeps its list identical to the code's), and again on every public read (a method that no longer validates is not shown).

## Reports and Harvest staff takedown (founder decision 26 Nov)
- **Report button** on the public Ways to give block (link in bio; the embeddable component takes the page's own `reportUrl`). Any visitor, no account:
  a reason (impersonation, scam, wrong details, inappropriate, other) and an optional note of up to 500 characters. Route `POST /l/:handle/report`:
  same origin, JSON, 4 KiB, honeypot, accepted only while the page is published with the block shown.
- **Rate limit** like the link-in-bio click and message forms: the visitor key is the same keyed hash of the client address, kept only in a one-minute
  counter (`giving_report_quotas`, purged after two minutes): 3 reports a minute per visitor and ministry, 30 a minute per ministry. A report row stores the
  ministry, page, handle, reason, note and status only; no address, key or account.
- **Staff** (`platform_staff`, the Discover review role, fresh sign-in within 15 minutes): `/platform/giving`. Reviewers and admins list reports by status
  (open, reviewed, dismissed) and mark them reviewed or dismissed. **Hiding (reason required) and restoring are staff admins only** (founder, 26 Nov, the
  same rule as Discover standing), enforced in `platform_giving_standing`, in the server, and in the screen (reviewers do not get the buttons). Every call
  writes a `platform_staff_audit` row (`giving.reports`, `giving.report.reviewed|dismissed`, `giving.standing.hide|restore`).
- **Alerts:** in-app only (founder, 26 Nov): the open-report count is a badge in the staff page header and on the Open tab (`platform_giving_open_count`).
  No email or other notification.
- **Effect:** `giving_standing.hidden` makes `giving_public_methods` (and so the link-in-bio block and any embed) and the owner preview return nothing for
  the ministry. The owner keeps editing the list and sees "Hidden by Harvest staff" with the reason; owners cannot lift it (no write grant).
- Tables `giving_standing`, `giving_reports`, `giving_report_quotas`: RLS forced, no app grant except owner/admin SELECT on their own standing; all other
  access through the definers (`bio_report_giving`, `platform_giving_reports`, `platform_giving_resolve_report`, `platform_giving_standing`).
  One owner-only read policy on `workspaces` lets the staff definers read a ministry's name, narrowed to ministries that have a report or the one ministry
  a standing change names, and only while they set their flag. Every giving definer resets its settings to empty when it finishes; `bio_scope_clear` and
  `community_definer_reset` also clear them, so a value the app pre-set never reaches another owner definer (review of 85f6b9f).
- **No tenant-keyed public read:** `giving_public_methods(uuid)` is not granted to the app (it would return any ministry's enabled bank details for any
  tenant id). Each public page gets its own definer that first resolves a published page (link in bio: `bio_public_giving`); the campaign page adds its
  own. The owner's editor preview reads through row security as the manager (`managerGivingPreview`).

## Reuse and exceptions
- Reused: Item/ItemGroup, Button, Switch, Dialog, Field/Input, Alert, SearchableSelect, EmptyState, FormSection, StatusBadge, ConfirmDialog, CopyButton,
  link-in-bio Row/EditorShell and `safeHttpsUrl`. No new kit items, no new dependencies. Brand logos (founder request 26 Nov) come from Simple Icons 16.38.1 (CC0-1.0, copied, not installed) for 12 kinds; bank transfer and the 8 brands without a verified mark keep generic lucide icons (`src/components/giving/giving-logos.tsx`, docs/ui-sources.md "Ways to give logos").
- Kind names (PayPal, Wise, Venmo, Zelle, Revolut, Cash App) are the ministry's own account labels at the founder's request; all other copy is provider-neutral.

## Evidence (author-executed)
- `tests/unit/ways-to-give.test.ts`: IBAN/BIC, URL allow-lists for every platform (incl. the Planning Center subdomain rule), no "other" kind, report input, handles, input schema and issues, public re-validation, bio block schema, navigation,
  capability mapping, production gate.
- `tests/integration/ways-to-give.test.ts`: roles (owner/admin vs member/viewer/outsider), server and database validation, version/stale, reorder,
  delete, audit without account details, RLS (member, viewer, other ministry, public setting from the app role), public allow-list and order,
  link-in-bio publish/hidden/disabled/unpublished, the database refusing `other`, visitor reports (validation, origin, honeypot, rate limit, nothing
  identifying stored, closed to the app role), staff list/resolve and open count (non-staff get 404), takedown by an admin hiding every public read, a
  reviewer refused by the server and the database, owner notice, restore, staff audit rows, the database host check for every platform, the app unable to
  call `giving_public_methods`, and settings the app pre-sets never widening owner definers' view of `workspaces`.
- Existing link-in-bio, navigation, access-guard, source-guards and migration unit tests pass; typecheck and eslint clean on changed files.
- Not run: full browser suite (disk). Responsive and light/dark not visually verified in a browser; the screens use theme tokens and 44px targets.

## Not included
- Pledges, recorded gifts and goal/raised totals (feat/cw-pledges). The campaign page embed itself (that builder calls `publicGivingMethodsFor` and
  renders `WaysToGive`). QR codes for methods, per-campaign method selection. Production migration not applied; feature off in production.
- Staff email alerts (in-app badge only, by decision); reporting from and embedding on the campaign page need that page's own definer and report route.
