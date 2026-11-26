# Ads overview, account health and flag-only rules (acceptance)

Launch roadmap, Phase 5 Social: Ads overview dashboard, the Ads row in the Social media sidebar, and Ads account health, alerts and automatic rules. Founder approved parallel work on 26 Nov. Everything stays hard-off: the screens answer 404 in production (the non-production social gate), `ADS_INTEGRATION_ENABLED` stays the literal `false`, and in development and tests the screens run against the in-memory test provider with invented accounts and numbers. No real provider call, no spend, no outbound message.

Founder decision 26 Nov: **ad rules are flag only.** A rule never turns anything off and never changes a budget.

Status key: BUILT / UNCHANGED / DEFERRED (reason).

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Overview dashboard: spend, results, cost per result over a period, with the shared stat and chart components | BUILT | Route `/workspaces/[id]/social/ads/overview` (owner and admin, `ads:manage`). Four shared `StatCard`s (spend, results, cost per result, active campaigns) with the change against the previous period of the same length, and the shared `SeriesCard` (spend, results, cost per result, clicks, impressions per day) with the Social Analytics `RangePicker`. A rising cost per result reads red (`upIsGood`). |
| 2 | Real numbers only | BUILT | Every figure comes from the stored results the Ads routes return; a measure nobody reported reads Unavailable, a day without data is a gap. Unit `ads-overview` (budget spend never assumed), integration `ads-overview` (unreported results stay unavailable). |
| 3 | Needs attention: paused for errors, budget nearly spent, disapproved ads, account health problems | BUILT | `attentionItems` (`src/lib/ads/overview.ts`): account status, failing or warning checks with fix links, a failing refresh, the last refusal, open alerts (dismissible), rejected ads, ads with a delivery issue, budgets at 90 % or more (daily: today's spend in the ad account's day; lifetime: since the budget's start), and rule flags from the last 7 days. Urgent first; an alert and the ad record it is about appear once. Unit tests. |
| 4 | Ads row in the Social media sidebar with its own icon, through the typed navigation registry | UNCHANGED (already built) | The `ads` entry (lucide `Target`, group Social media, `ads:manage`) shipped with the Ads manager (#241); `under("/social/ads")` keeps it active on the overview and rules pages (e2e asserts it). No sidebar count changes. |
| 5 | Account health panel per connected ad account | BUILT | `AdsAccountHealth`: one card per account with the eight named checks (a check the network never answered reads Not confirmed, never OK), a summary badge, the last check time and Check now (stores a fresh answer through the existing health route). |
| 6 | Alert rules (spend above X, cost per result above Y) | BUILT | Route `/workspaces/[id]/social/ads/rules`: shared `DataTable` of rules with an on switch, a New rule dialog (watch level, measure, above / at least / below / at most, limit, 1 to 30 days), a side panel with what the rule would flag now (preview, changes nothing) and its recent checks, Check rules now, remove with confirmation. |
| 7 | An automatic rule only records or flags, never changes spend | BUILT | Server: `ruleInput` accepts only `notify` (422 otherwise); enabling a stored non-flag rule is refused (`ADS_RULE_FLAG_ONLY`); `runRules` no longer calls the status path at all and runs only flag rules. Database (migration `0123_ads_rules_flag_only`): existing pause rules are switched off, the `ads_rules_shape` CHECK forbids an enabled non-flag rule, and the `ads_rules_flag_only` trigger (pinned `search_path`, not a definer, no `app.*` flags) refuses inserting a non-flag rule or changing a rule's action to one. Screen: a stored pause rule shows "Pause (not offered here)" with its switch disabled. Integration `ads-overview` and `ads-server` (a flag run calls nothing on the ad account and writes no status audit). |
| 8 | Copy concise and provider-neutral; theme tokens; 44 px targets; light and dark | BUILT | Copy under `Ads.overview` and `Ads.rules`; the copy test finds every key and no vendor name. E2E `ads-overview.spec.ts`: axe (WCAG 2.0 to 2.2 A and AA) and no horizontal overflow at 360, 768 and 1280 in light and dark, 44 px targets on phone. Screenshots `overview-*`, `rules-*` in `docs/screenshots/ads/`. |
| 9 | Kit item approval gate | BUILT (no new item) | Only the items approved for Ads on 25 Nov and the shared stat cards and charts; recorded in `docs/ui-sources.md` and `adsKitApprovals`. |

## Not included

- No real provider, no schedule for rule checks (Check rules now is a person's step; the server sync worker stays hard-off).
- Rule flags are shown on the overview; they do not send notifications or email.
- Breakdowns, campaign detail and audiences screens (PRD 5.5) stay with their own PRs.

## Evidence (local, 26 Nov)

- Unit: `tests/unit/ads-overview.test.ts` (budget windows and shares, needs-attention order and de-duplication, health rows, flag-only payload and the server schema refusing `pause`, rule flags), `ads-screens.test.ts` (copy keys, vendor names, kit approval headers). Full unit suite: 157 files, 1813 tests passed.
- Integration (embedded PostgreSQL, as `ubuntu`): `tests/integration/ads-overview.test.ts` (4 tests: range and previous period reads, a flag run changes nothing and calls nothing on the ad account, member 404, and the stored pause rule refused by the API, the CHECK and the trigger and never run) and `ads-server.test.ts` (rules test rewritten for flag only). 21 passed.
- Browser (webpack dev server, one worker): `ads-overview.spec.ts` passed; `ads-manager.spec.ts` 3 passed (header gained Overview and Rules links; its screenshots were refreshed).
- Migration `0123_ads_rules_flag_only`: switches off stored non-flag rules, tightens `ads_rules_shape`, adds the `ads_rules_flag_only` trigger. RLS on `ads_rules` is unchanged (ENABLE and FORCE from 0098); no grant or policy changes, no definer.
