# Fundraising pledge campaigns: first phase (acceptance)

Design: `docs/superpowers/specs/2026-11-17-fundraising-pledge-campaigns-design.md` (proposal, PR #113). Founder decisions: 16 Nov (Operations > Giving; Harvest
does not process card payments; the ministry collects through its own links; Harvest records pledges and gifts the ministry confirms; money in cents) and
26 Nov (until a provider exists, an admin records gifts by hand; a campaign's raised total is those gifts; its goal comes from the CW-09 budget settings).

This PR is the first coherent phase: slice F1 (data and server) plus the staff part of F3 (confirmed gifts, corrections, progress) and their core screens.
Record keeping only. No provider, payment flow, webhook, public page, outbound message or production activation. Off in production (`fundraisingEnabled`).

## Model (migration 0117, tentative number; the coordinator renumbers at merge)

| Table | Holds | Access |
| --- | --- | --- |
| `fundraising_campaigns` | title, summary, optional outreach campaign, goal (bigint cents), one currency, draft/published(open)/closed/archived, version | Giving area (owner/admin, Giving collaborators with manage) |
| `fundraising_pledges` | intention: amount, currency, optional supporter name / contact detail / CRM contact, pending/accepted/cancelled, expected date | owner/admin only |
| `giving_ledger_entries` | append-only gifts and reversals: signed cents, currency, gift date, method label (free text), reference, confirmer and time | owner/admin only; SELECT and INSERT only |
| `giving_contact_links` | who a gift without a pledge came from (name or CRM contact); detachable, never part of the money row | owner/admin only |

## Checklist

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| M1 | Integer cents (bigint) at rest, decimal strings at the API, bounded 1 to 1e12; no floats, rounding or conversion | [x] | `cw-pledges.test.ts` (bounds) |
| M2 | Two-decimal currency allowlist (16 codes; RON added by the founder 26 Nov), database check equals code list | [x] | `cw-pledges.test.ts` (JPY, KWD refused) |
| M3 | Every pledge and ledger row carries the campaign's currency (composite FK on tenant, id, currency); currency cannot change once anything is recorded | [x] | `cw-pledges.test.ts` (currency locked, USD row on CAD campaign refused 23503) |
| M4 | Raised = net confirmed ledger entries only; pledges have a separate total; no combined figure; totals never clamped to the goal | [x] | `cw-pledges.test.ts` (exact totals) |
| M5 | Ledger append-only for every role (statement trigger), app has no UPDATE/DELETE grant | [x] | `cw-pledges.test.ts` (app 42501, migration owner refused) |
| M6 | Correction = exact reversal (+ optional replacement in the same chain); one reversal per gift (unique index, concurrent attempts: one wins); no reversal of a reversal; forged reversal refused by trigger | [x] | `cw-pledges.test.ts` (corrections) |
| M7 | Idempotent creates for campaigns, pledges, gifts and corrections; a changed payload with the same key conflicts | [x] | `cw-pledges.test.ts` |
| M8 | Gifts are recorded only with the explicit "confirmed by the ministry" statement and attributed to the recording person (RLS `confirmed_by = app.user_id`) | [x] | `cw-pledges.test.ts` (missing statement 400, forged confirmer 42501) |
| M9 | Free-text method and reference refuse card/account-like numbers | [x] | `cw-pledges.test.ts` |
| L1 | Lifecycle draft -> open -> closed -> archived (or draft -> archived), no reopening, versioned, enforced by trigger as well | [x] | `cw-pledges.test.ts` (lifecycle, direct SQL 23514) |
| L2 | Closed: no new pledges, but gifts are still accepted on purpose (gifts confirmed after closing still belong to the campaign) and corrections remain possible; archived: no new gifts, corrections possible | [x] | `cw-pledges.test.ts` |
| E1 | CRM erasure (contact re-key): `giving_contact_before_rekey` clears the pledge's contact, supporter name and contact detail (version + 1) and deletes gift supporter links; ledger rows and totals are unchanged | [x] | `cw-pledges.test.ts` (erasure) |
| E2 | CRM merge: `merge_contacts_scoped` moves pledges and gift supporter links from the source to the kept contact before the source is re-keyed; the link key has no cascade, so attribution never disappears silently | [x] | `cw-pledges.test.ts` (merge) |
| K1 | A correction's replacement gift uses a server-derived key (`replacement.<reversal id>`); client keys may not use that prefix | [x] | `cw-pledges.test.ts` |
| K2 | Recording a gift against a pledge holds a share lock on the pledge, so a concurrent cancel waits | [x] | source review |
| C1 | CW-09: a fundraiser linked to an outreach campaign takes goal and currency from its budget settings when left empty; one live fundraiser per campaign | [x] | `cw-pledges.test.ts`; unique partial index |
| C2 | Outreach campaign page shows goal / raised / progress, or a set-up button using the budget goal | [x] | `campaign-fundraising-card.tsx` (not browser-run) |
| P1 | FORCE RLS on all four tables, no PUBLIC grants, policies use `access_role` (via `giving_can`), no inline `role_id` | [x] | `cw-pledges.test.ts`; `access-guard.test.ts` |
| P2 | Members and viewers see nothing; Giving collaborators manage campaign settings but get no totals, pledges, gifts or supporter rows (code and database agree) | [x] | `cw-pledges.test.ts` (privacy) |
| P3 | Another ministry: unknown ids (404), no rows | [x] | `cw-pledges.test.ts` |
| A1 | Audits: create, update (field names and version), open/close/archive, pledge record/accept/cancel, gift confirm, gift correct, every donor-data read (`giving.donors.read`); metadata holds ids only, no names, contact details or amounts | [x] | `cw-pledges.test.ts` |
| U1 | Screens rebuilt from the founder-approved kit items (27 Nov, real kit code): list tables12, tiles stat-card7, records tables22, dialogs form-layout8, campaign card stat-card17; on the shared DataTable, Dialog + Field, ConfirmDialog, Progress; lifecycle actions Harvest-owned | [x] | `ui-provenance.test.ts`; `docs/ui-sources.md` Giving screens |
| U2 | Copy concise and provider-neutral; never "verified" or "payment received"; 44px tap targets below 1024px | [x] | `copy-rules`, `source-guards`; not browser-run |

## Not included (later slices)

- F2 public campaign and pledge pages, abuse controls and the collection gate (needs privacy, abuse and legal decisions and the founder's collection authorization).
- "Ways to give" methods (separate builder, `feat/cw-giving`); the gift's free-text method label can later sit beside a method id.
- External giving links, CRM timeline projection (amount-null reference), giving exports, public suppressed progress, giving drafts.
- A CRM contact picker in the screens (the server accepts a same-ministry contact id); ministry-wide (non-campaign) giving records; pledge editing.
- Free-text supporter fields (name, contact detail) on a pledge or gift that has no CRM contact are outside CRM erasure for now: CRM erasure only reaches rows linked to the erased contact. A giving-specific erasure path waits for the LEGAL retention decision; no real data until it is settled.

## Giving screens rebuilt from the UI kit (27 Nov 2026)

The fundraising list, detail tiles, Gifts and Pledges card, record/edit dialogs, outreach campaign card, give page settings, Ways to give manager and method
dialog, the public Ways to give block, its Report dialog and the public give page start from the real kit code of the eleven approved items (table and identical-line
share per file in `docs/ui-sources.md`, "Giving screens"). Business logic, permissions, routes, retry keys, owner-only totals, pledges never counted as raised,
small-group suppression and the ConfirmDialog lifecycle actions are unchanged.

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| K1 | Every kit-derived file carries the provenance header and a `kitProvenance` row | [x] | `ui-provenance.test.ts` |
| K2 | No new dependency; tanstack, react-hook-form, zod 3, valibot, formisch and vaul replaced by DataTable, FormData and existing validation | [x] | `package.json` unchanged |
| K3 | Copy in the catalogue, theme tokens only, 44px targets below lg, no vendor names in copy | [x] | `npm run lint` (source guards) |
| K4 | Public give page: progress, Ways to give, Report, amount hidden when switched off, axe clean, no horizontal scroll at 1280 and 360 | [x] | `tests/e2e/give-page.spec.ts` |
| K5 | Screenshots at 390 and 1440, light and dark (device scale 2): list, detail, record-gift dialog, Ways to give manager, public give page | [x] | `docs/screenshots/giving-kit/` |


See the PR body for the commands and counts run on the final head.
