# Ads screens acceptance

Stacked on the Ads server branches (`feat/ads-server` #232, `feat/ads-crm` #239, `feat/ads-forms-source` #240). Screens only: no new provider call, no real ad account, no spend. Everything stays hard-off: the screens answer 404 in production (the non-production social gate, `ADS_INTEGRATION_ENABLED` stays the literal `false`), and in development and tests they run against the in-memory test provider with invented accounts, campaigns, results, leads and posts (`src/server/ads/seed.ts`, reachable only through the open gate). Founder 25 Nov: "build the ads in the style of an ads manager: a 3-level table Campaign, Ad set, Ad; and ad creation like in the platform". Structure only is copied; no network branding, colour, icon or copy. Kit approvals: `docs/ui-sources.md` (Ads screens) and `adsKitApprovals`.

## PR 1: Ads manager (this change)

Route `/workspaces/[id]/social/ads`, nav item **Ads** (target icon) in Social media between Auto-DM and Analytics, owner and admin (`ads:manage`).

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Summary cards: spend, results, cost per result, reach, with the Social Analytics range picker (7, 28, 90 days or custom) | BUILT | Shared `StatCard` and `RangePicker` reused. Reach is shown **per day (average)** because the server never totals reach across days; a measure nobody reported reads Unavailable, never zero. Unit tests. |
| 2 | Tabs Campaigns, Ad sets, Ads with counts; selecting rows on one level filters the next | BUILT | `visibleRows`, `pruneSelection` (unit); e2e selects a campaign, then an ad set. |
| 3 | Per-row on/off switch, confirm when it can start spending | BUILT | Turning on asks first (dialog); turning off does not. Versioned, idempotent calls; refused or stale changes show a message. e2e. |
| 4 | Name with status and review state, delivery, budget, results, cost per result, reach, impressions, spend, ends | BUILT | Delivery reads the review result and delivery issue before the switch and a past end date as Completed (`deliveryOf`, unit). |
| 5 | Totals row | BUILT | Shared `DataTable` gained an optional `totals` row (table) and summary block (cards). e2e. |
| 6 | Columns picker: Performance, Delivery, Engagement, Custom | BUILT | `ColumnsMenu`; Custom has one checkbox per column; columns that do not apply to a level are dropped. e2e. |
| 7 | Bulk on/off | BUILT | Up to the server's 50; turning on asks first. e2e. |
| 8 | Name opens the right-side edit panel | BUILT | Rename, delivery switch, budget and end date (campaign, ad set) with an explicit confirmation of the spend change, review result (ad), remove with an irreversible warning. e2e. |
| 9 | Account selector and account health banner | BUILT | One banner for account status, failing or warning health checks with fix links, the last refusal and open alerts (dismissible). e2e. |
| 10 | Phone layout is cards | BUILT | Shared `DataTable` card layout; 44px targets asserted. e2e. |
| 11 | Empty and error states, find ad accounts through the connected social account | BUILT | e2e. |

Not in this PR: guided create and Boost a post (PR 2), lead forms and leads (PR 3).

## Reuse and exceptions

Reused: `AppShell` and the typed nav registry, `DataTable` (extended with `totals`), `StatCard`, `RangePicker`, `StatusBadge`, `EmptyState`, `ConfirmDialog`, `Sheet`, `Alert`, `Switch`, `DropdownMenu`. New Ads-only pieces are compositions of those; nothing duplicates a shared component.

## Evidence

- Unit `tests/unit/ads-screens.test.ts` (table model, copy keys, kit approval record), `navigation.test.ts` (Ads is live).
- E2E `tests/e2e/ads-manager.spec.ts` with axe (WCAG 2.0 to 2.2 A and AA) and no horizontal overflow at 360, 768 and 1280, light and dark; screenshots in `docs/screenshots/ads/`.
