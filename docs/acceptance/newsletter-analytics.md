# Newsletter Analytics screen

Public > Newsletter > Analytics (`/workspaces/[tenantId]/newsletter/analytics`, nav id `newsletterAnalytics`, feature `newsletter`, permission `newsletter:analytics`, live only outside production like the other newsletter routes). It is the first entry of the Newsletter group (order: Analytics, Campaigns, Audience, Sign-up forms). Sending stays hard-off; nothing here sends, schedules or calls a provider. All five HC-02 gates remain UNAPPROVED.

## What the server can report (inspected)

The merged newsletter server (#165) keeps one delivery record per selected recipient for 90 days and, after that, anonymous per-day counts. Queryable per campaign and per UTC day: recipients selected, skipped (by reason), queued, attempted, failed, unconfirmed, needing review, accepted by the provider ("sent"), delivered, bounced, complained, unsubscribed. **Opens, clicks and link clicks are not collected anywhere** (no tracking pixel, no link rewriting, no column), so the screen does not show them and says so in one footer line. See "Server gaps".

## Done

- Overview: period tabs (7, 30, 90 days, UTC, through `?period=`), six tiles (campaigns, sent, delivered, bounced, complaints, unsubscribed; rates are shares of sent), a daily chart (sent, delivered, bounced, unsubscribed), a sortable campaigns table (sort by name or any figure) whose rows open that campaign's analytics, and an "Audience now" card (subscribed, unsubscribed, bounced or suppressed) from the Audience status data, which is derived from the consent ledger. There is no growth trend: the ledger has no per-day history of those counts.
- Campaign analytics (`/newsletter/analytics/[campaignId]`, reached from a table row or the Analytics item in the Campaigns list row menu; the sidebar stays on Analytics): tiles with rates, the series since send (at least a week, from the first day with records, up to 90 days), and the delivery status breakdown. Drafts and unsent campaigns show "Not sent yet". Top links clicked is not possible (no click data).
- Empty state: "No sends yet" because sending is off; tiles read zero.
- Privacy: aggregate only, no recipient is ever listed or returned. Groups under 5 are withheld by the server's existing rule and shown as "Fewer than 5" (tiles, table cells, chart gaps, audience counts of 1 to 4). A period total is withheld when any day in it is a small group. Do not contact wins in the derived audience status and in send-time eligibility already. UTC throughout. Windows end at 90 days; nothing older is implied.
- Permissions: owners and admins only. The server capability `newsletter:analytics` (RLS on deliveries, SECURITY DEFINER functions) is owner and admin, so members and viewers see the no-access note and no sidebar link; other ministries get 404. (The brief allowed member read; the existing server model does not, and changing it needs a migration.)
- Navigation: planned entry made live and moved to the top of the group. CRM Campaigns (`/campaigns`) is not matched on any `/newsletter/*` route (unit test and e2e).

## Server

No migration. `analyticsIn` was extracted from `newsletterAnalytics` (same behaviour) so the overview runs the aggregate once per campaign in one transaction. New `src/server/newsletter-campaigns/analytics-overview.ts` (`newsletterAnalyticsOverview`, `newsletterCampaignAnalytics`), pure helpers in `src/lib/newsletter-analytics.ts`. The overview lists the 50 most recent sent campaigns (note shown beyond that). Needs the suppression keys env like the existing analytics route.

## Server gaps and decisions needed

- Opens, clicks and top links: need a tracking design (pixel, link rewriting, retention, consent and Apple Mail preload handling). Not built; a privacy decision first.
- Members cannot read analytics (owner and admin capability in the database).
- No history of audience counts, so no growth trend.
- Per-campaign series uses the day a recipient was selected, not the day an outcome arrived.

## Reuse and provenance

Reuses the CRM Reports tiles (`ReportStatCards`, caption now optional), period tabs (`ReportPeriodTabs`, now generic over its periods), bars card (`ReportBarsCard`), shared `DataTable`, `StatusBadge`, `EmptyState`, `Card`, `ChartContainer`. One new shared component: `ReportTrendCard` (multi-line chart with a screen-reader table), consumed by both analytics pages. Kit (premium admin-dashboard @ `1631106`): the trend card is derived from `hotel/components/campaign-overview.tsx` (11 of 49 lines identical); the tiles, bars and tabs were already derived from `ai-analytics` (unchanged provenance, counts re-measured). Free recharts only (already approved). The kit's range select and download button were not used (period tabs already exist); chat-app has no chart or tile block. Recorded in `src/lib/ui-provenance.ts` and `docs/ui-sources.md`.

## Evidence

Unit: `tests/unit/navigation.test.ts` (live entry, first in group, owner and admin, CRM Campaigns never matches newsletter routes). Integration (restricted migration owner): `tests/integration/newsletter-analytics.test.ts` (quiet, totals and series in UTC, 7/30/90 windows, small groups, audience counts, owner and admin only, cross-ministry isolation, campaign detail, unsent and small campaigns). Synthetic deliveries are written only by `tests/helpers/newsletter-analytics-seed.ts` into the disposable test database. E2E: `tests/e2e/newsletter-analytics.spec.ts` with axe, no horizontal scroll and screenshots at 360, 768 and 1280 in light and dark (main screen), plus one desktop scene per scheme for the campaign page; run with shell modes on and `HARVEST_SHELL_MODES=disabled`. Screenshots: `docs/screenshots/newsletter-analytics/`.
