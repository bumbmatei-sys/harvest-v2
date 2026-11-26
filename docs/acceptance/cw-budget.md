# Campaign budgets and dashboard funding — acceptance

Item: the last Campaigns launch gap (founder goal 26 Nov: every campaign feature needed for launch is complete). PRD `docs/prd/harvest-campaign-wizard.md`,
"What Happens After Clicking Finish?" item 4 ("Budget: Expense categories, financial dashboards, and budget tracking") and item 1 (dashboard funding);
launch scope `docs/prd/professional-v1-launch-scope.md` rows 2 ("basic income/expenses and budgets, campaign-linked finance") and 3 ("organizer … sees budget").
Record keeping only: no money moves, no payment provider is called, nothing is published or sent.

## Delivered

- **Migration `0120_campaign_budget`** (after 0119 ways to give). References only `campaigns`, `users` and its own tables.
  - `campaign_budget_lines`: one row per campaign and category (unique), `planned_cents` bigint 0..1e12, currency, version, creator.
  - `campaign_expenses`: `spent_on`, category, `amount_cents` bigint 1..1e12, currency, description (1–200), optional payee and reference (1–120), `recorded_by`, version.
  - Categories (fixed keys; CW-09 had none to reuse): venue, equipment_production, marketing_media, printing_materials, travel_transport, accommodation, hospitality_food, volunteers_staff, security_medical, administration, other.
  - Currency checked against the fundraising two-decimal list (same as `fundraising_campaigns`).
  - ENABLE + FORCE RLS; `REVOKE ALL` from PUBLIC and `harvest_app`, then SELECT/INSERT/DELETE and column-limited UPDATE (lines: planned amount; expenses: date, category, amount, description, payee, reference). Tenant, campaign, line category, currency and creator columns are not updatable.
  - Policies through `public.access_role(tenant, user, 'campaigns', role_id)`: read for owner/admin/member/viewer (and collaborators with the campaigns area); insert/update/delete for owner/admin (a collaborator with campaigns "manage" counts as admin) on an unarchived campaign, inserts always as the caller. No SECURITY DEFINER function.
- **Permissions decision.** Budgets are finance records, so only owners and admins manage them, even though members can write other campaign data (boards). Members and viewers read planned/spent/remaining per category and in total; the individual expenses (description, payee, reference, recorder) are returned to owners and admins only. The database lets campaign readers read expense rows so their totals can be summed without a definer function; the server is what withholds the details (see "Open decision").
- **Currency.** One per campaign: the wizard's step-6 currency when it is a supported two-decimal currency; USD for a campaign made without the wizard; an unsupported wizard currency (e.g. JPY) shows the budget read-only with a notice and refuses writes (409). A row in another currency blocks further writes (409) rather than mixing currencies.
- **Server** `src/server/campaign-budget.ts` (all through `withTenant`): `getCampaignBudget` (`campaigns:read`), `createBudgetLine`, `updateBudgetLine`, `deleteBudgetLine`, `createExpense`, `updateExpense`, `deleteExpense` (`campaigns:write` plus owner/admin). Version-checked (409 on stale), 404 for another campaign's or ministry's row, 1000 expenses per campaign. Audit rows `campaign.budget_line.*` and `campaign.expense.*` carry ids, category and changed field names only, never amounts or text. Removing a line keeps its expenses (shown as "Not planned").
- **API**: `GET …/campaigns/[campaignId]/budget`; `POST …/budget/lines`; `PATCH`/`DELETE …/budget/lines/[lineId]`; `POST …/budget/expenses`; `PATCH`/`DELETE …/budget/expenses/[expenseId]` (origin-checked writes, `private, no-store`).
- **Screen** `/workspaces/[tenantId]/campaigns/[campaignId]/budget`, linked by an "Open budget" card on the campaign page: planned / spent / remaining tiles with a Progress bar; by-category DataTable (planned, spent with a small bar, remaining, red when overspent, "Not planned" badge); expenses DataTable with add, edit and remove (Dialog + Field forms, ConfirmDialog for removal) for owners and admins; EmptyState for none. Copy under `CampaignBudget` in `messages/en.json`.
- **Dashboard** (`getCampaignOverview`): new `budget` (planned, spent, remaining, counts; null with no line or expense) shown as "Budget spent: X of Y" or "No budget yet"; new `funding` (raised vs goal) read through the existing `campaignFundraising`, so only people the fundraising rules let see raised totals (owners and admins) get it. Then "funding" leaves `unavailable`; everyone else, a campaign without a linked fundraiser, and production (fundraising off) keep "Not available yet".
- **Checklist**: "Define budget" ticks itself once the campaign has a budget line (same mechanism as the campaign-events auto-tick).

## Reuse and exceptions

Shared components only: Card, DataTable, Dialog, Field/FieldGroup, Input, NativeSelect, Progress, EmptyState, StatusBadge, ConfirmDialog, Alert; money helpers from `src/lib/fundraising.ts` (`formatCents`, `parseCents`, `centsText`, `centsInput`, `MAX_CENTS`). No new kit item, so no approval list and no provenance row. The small form-dialog wrapper in `campaign-budget.tsx` mirrors the fundraising one (not exported, and fundraising's carries retry keys and attestations).

## Evidence (author-executed)

- `tests/integration/cw-budget.test.ts`: 10 passed (database shape, grants and RLS forced; totals, remaining and unplanned spending; money bounds and input; currency; version conflicts and audit content; access per role, collaborator and other ministry; RLS for the application role; archived read-only; dashboard budget and checklist; funding visibility).
- With `campaign-wizard`, `cw-boards`, `cw-pledges`, `cw-campaign-events`, `campaigns`, `rls`, `feature-access`, `campaign-wizard-migration-owner`: 9 files, 117 passed.
- Unit suite: 156 files, 1803 passed. `tsc --noEmit` clean; eslint clean on changed files; second `drizzle-kit generate`: "No schema changes".
- `tests/e2e/campaign-wizard.spec.ts` updated (Budget spent / No budget yet / Open budget; overview `budget: null, funding: null`); **not run** (browser suite skipped for disk space). No screenshots: responsive and light/dark behaviour rely on shared components and tokens and are unverified in a browser.

## Open decision

- Should members and viewers see the individual expenses (payee, reference)? Currently they see totals only, enforced by the server; the database policy lets campaign readers read the rows. Tightening it in the database would need a definer function for their totals.

## Not included

- Approval workflows, receipts/attachments, income lines other than fundraising, exports, multi-currency conversion, per-department budgets.
- Fundraising gifts flowing into the budget (funding is shown beside it, not added to it).
