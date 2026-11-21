# Social analytics screens acceptance

Route `/workspaces/[tenantId]/social/analytics` (Public mode, Social media, Analytics). It reads the server merged in #162 (`docs/acceptance/social-analytics.md`) and nothing else. The refresh worker, `SOCIAL_ANALYTICS_REFRESH_ENABLED`, the integration constants and the vendor network constants stay hard-off, and the screen has no refresh control and sends no request other than GET. All five HC-02 gates remain **UNAPPROVED**. Nothing here is approved or deployed.

## What the screen does

| Area | Behaviour |
| --- | --- |
| Gate | Same non-production gate as Publish (`requireSocialScreens()` before any session or database work, then owner or admin through `social:analytics`; neutral not-found otherwise). The two Analytics routes now take `socialRouteDeps()` (the same test dependencies as the Publish routes) so they answer in the gated test setup and stay 404 in production. |
| Filters | Date range (last 7, 28 or 90 days, or two dates up to 366 days, default last 28) and an account or platform scope. The browser's time zone is sent and shown. |
| Summary cards | Posts published, exposure (reach, else impressions, else views, as the server names it), engagement, follower change. Each has a change against the previous period of the same length, a bar sparkline and a Partial marker. |
| Time series | One chart for the selected measure; days without a reading are gaps in the line and read "Unavailable" in the screen-reader table. |
| Per platform | One row per platform with the four measures and a Reconnect, Delayed or Not measured yet badge; stacked blocks on phones. |
| Top and bottom posts | Ranked by engagement. A row with a planner record opens a drawer (every measure the provider reports, engagement per day, link to the planner); a post published elsewhere is listed without a drawer. |
| Best times | Day by hour table of average engagement from the posts in the range (in the chosen time zone) or the provider's audience times (UTC), with the highest slot named in text. Hours run across on wide screens; days run across on phones so seven columns fit at 360. |
| Freshness and partial results | Last refresh time; banners for expired connections (with a link to Social accounts), delayed accounts, accounts not measured yet and a truncated report. Numbers that exist stay on screen. |
| Unavailable is not zero | A reading with a null value shows "Unavailable" everywhere; a delta needs both periods; a sparkline or chart with no reading says so. |
| States | Skeletons for the first load, an empty state with a link to Social accounts, a "nothing in this range" state, an error state with Try again, and the neutral unavailable state. |
| Polling | Re-reads every 60 s while visible with `If-None-Match`, reuses the data on 304, honours `Retry-After`, pauses while hidden. It never shows a loading state and never replays the entrance. |

## Kit blocks

Sources are the founder's premium kit (`bumbmatei-sys/admin-dashboard`, commit `1631106`). The registry names `stat-card12`, `chart56` and `chart60` are not in the repository copy, so the same block families in its dashboard pages were used. Measured with `scripts/ui-identical.sh`:

| Harvest file | Kit file | Identical |
| --- | --- | --- |
| `src/components/ui/chart.tsx` (copied) | `components/ui/chart.tsx` | 334 of 337 (99%) |
| `src/components/social/analytics/count-up.tsx` (derived) | `components/ui/custom/count-animation.tsx` | 8 of 14 (57%) |
| `src/components/social/analytics/stat-card.tsx` (derived) | `finance/components/kpi-cards.tsx` | 14 of 60 (23%) |
| `src/components/social/analytics/series-card.tsx` (derived) | `sales/components/revenue-chart.tsx` | 10 of 61 (16%) |

The platform table, posts list, heatmap, range picker, banners, drawer, data hook and entrance hook have no kit source. The founder's first Harvest version (`harvest-agent`, `SocialAnalyticsView.tsx`) was used for features and layout only; no code or data plumbing was taken. Recorded in `docs/ui-sources.md` and `src/lib/ui-provenance.ts`.

## Motion

- Entrance: cards fade and rise with a 60 ms stagger (CSS, 300 ms), charts draw in (recharts' own 300 ms animation), numbers count up (0.4 s). It plays once per visit, when data first arrives. Filters, scope changes and the 60 s polling never replay it, and with `prefers-reduced-motion: reduce` it never plays: no entrance classes, no chart animation, no count-up, no running animation.
- Content is in the DOM at full size from the first data render; the entrance only fades and moves it. The page root carries `data-entrance` (`waiting`, `playing`, `done`, `off`) and `data-ready` so tests know when it has settled.
- `motion` is imported by one file (`count-up.tsx`), loaded with `React.lazy` only while an entrance plays. The kit's count-up block is the only kit block here that pulls `motion`; the kit's stat card and chart blocks pull `recharts` only. No public page and no other route imports either library.
- First-load JS for the route, before and after: **NOT MEASURED** (see below).

## Verified and not verified

Filled in after the final run; see the pull request description for the exact counts.
