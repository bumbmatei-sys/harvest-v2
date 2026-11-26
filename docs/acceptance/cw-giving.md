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
- Pure library `src/lib/ways-to-give.ts`: kinds, exact-host allow-lists per named kind (any public https host for "Other", never IP literals or ports),
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

## Reuse and exceptions
- Reused: Item/ItemGroup, Button, Switch, Dialog, Field/Input, Alert, SearchableSelect, EmptyState, FormSection, StatusBadge, ConfirmDialog, CopyButton,
  link-in-bio Row/EditorShell and `safeHttpsUrl`. No new kit items, no new dependencies, generic lucide icons only (no provider logos).
- Kind names (PayPal, Wise, Venmo, Zelle, Revolut, Cash App) are the ministry's own account labels at the founder's request; all other copy is provider-neutral.

## Evidence (author-executed)
- `tests/unit/ways-to-give.test.ts`: IBAN/BIC, URL allow-lists, handles, input schema and issues, public re-validation, bio block schema, navigation,
  capability mapping, production gate.
- `tests/integration/ways-to-give.test.ts`: roles (owner/admin vs member/viewer/outsider), server and database validation, version/stale, reorder,
  delete, audit without account details, RLS (member, viewer, other ministry, public setting from the app role), public allow-list and order,
  link-in-bio publish/hidden/disabled/unpublished.
- Existing link-in-bio, navigation, access-guard, source-guards and migration unit tests pass; typecheck and eslint clean on changed files.
- Not run: full browser suite (disk). Responsive and light/dark not visually verified in a browser; the screens use theme tokens and 44px targets.

## Not included
- Pledges, recorded gifts and goal/raised totals (feat/cw-pledges). The campaign page embed itself (that builder calls `publicGivingMethodsFor` and
  renders `WaysToGive`). Logos, QR codes for methods, per-campaign method selection. Production migration not applied; feature off in production.
- Open for the founder: whether "Other link" may point at any https host (current) or must also use an allow-list (fundraising spec item 7), and a staff
  review/takedown process for impersonation.
