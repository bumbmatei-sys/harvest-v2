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
`other`. **GoFundMe and Donorbox are TEMPORARY and will be removed once a payment provider (Stripe or another) is added** (also noted next to the list in
`src/lib/ways-to-give.ts`, the schema check and `docs/decisions/founder-decisions-2026-11.md`).

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

The database checks the kind list and the link shape; the exact hosts are checked by the server on every write and again on every public read (a method
that no longer validates is not shown).

## Reports and Harvest staff takedown (founder decision 26 Nov)
- **Report button** on the public Ways to give block (link in bio; the embeddable component takes the page's own `reportUrl`). Any visitor, no account:
  a reason (impersonation, scam, wrong details, inappropriate, other) and an optional note of up to 500 characters. Route `POST /l/:handle/report`:
  same origin, JSON, 4 KiB, honeypot, accepted only while the page is published with the block shown.
- **Rate limit** like the link-in-bio click and message forms: the visitor key is the same keyed hash of the client address, kept only in a one-minute
  counter (`giving_report_quotas`, purged after two minutes): 3 reports a minute per visitor and ministry, 30 a minute per ministry. A report row stores the
  ministry, page, handle, reason, note and status only; no address, key or account.
- **Staff** (`platform_staff`, the Discover review role, reviewer or admin, fresh sign-in within 15 minutes): `/platform/giving` lists reports by status
  (open, reviewed, dismissed), resolves them, and hides a ministry's public giving details at once (reason required) or restores them. Every call writes a
  `platform_staff_audit` row (`giving.reports`, `giving.report.reviewed|dismissed`, `giving.standing.hide|restore`). Both staff roles may hide and restore.
- **Effect:** `giving_standing.hidden` makes `giving_public_methods` (and so the link-in-bio block, the editor preview and any embed) return nothing for the
  ministry. The owner keeps editing the list and sees "Hidden by Harvest staff" with the reason; owners cannot lift it (no write grant).
- Tables `giving_standing`, `giving_reports`, `giving_report_quotas`: RLS forced, no app grant except owner/admin SELECT on their own standing; all other
  access through the definers (`bio_report_giving`, `platform_giving_reports`, `platform_giving_resolve_report`, `platform_giving_standing`).
  One owner-only read policy on `workspaces` lets the staff definers read the reported ministry's name while they set their own flag.

## Reuse and exceptions
- Reused: Item/ItemGroup, Button, Switch, Dialog, Field/Input, Alert, SearchableSelect, EmptyState, FormSection, StatusBadge, ConfirmDialog, CopyButton,
  link-in-bio Row/EditorShell and `safeHttpsUrl`. No new kit items, no new dependencies, generic lucide icons only (no provider logos).
- Kind names (PayPal, Wise, Venmo, Zelle, Revolut, Cash App) are the ministry's own account labels at the founder's request; all other copy is provider-neutral.

## Evidence (author-executed)
- `tests/unit/ways-to-give.test.ts`: IBAN/BIC, URL allow-lists for every platform (incl. the Planning Center subdomain rule), no "other" kind, report input, handles, input schema and issues, public re-validation, bio block schema, navigation,
  capability mapping, production gate.
- `tests/integration/ways-to-give.test.ts`: roles (owner/admin vs member/viewer/outsider), server and database validation, version/stale, reorder,
  delete, audit without account details, RLS (member, viewer, other ministry, public setting from the app role), public allow-list and order,
  link-in-bio publish/hidden/disabled/unpublished, the database refusing `other`, visitor reports (validation, origin, honeypot, rate limit, nothing
  identifying stored, closed to the app role), staff list/resolve (non-staff get 404), takedown hiding every public read, owner notice, restore and the staff
  audit rows.
- Existing link-in-bio, navigation, access-guard, source-guards and migration unit tests pass; typecheck and eslint clean on changed files.
- Not run: full browser suite (disk). Responsive and light/dark not visually verified in a browser; the screens use theme tokens and 44px targets.

## Not included
- Pledges, recorded gifts and goal/raised totals (feat/cw-pledges). The campaign page embed itself (that builder calls `publicGivingMethodsFor` and
  renders `WaysToGive`). Logos, QR codes for methods, per-campaign method selection. Production migration not applied; feature off in production.
- Reports are not yet notified to staff (they check `/platform/giving`); reporting from the campaign page needs that page's own report route.
