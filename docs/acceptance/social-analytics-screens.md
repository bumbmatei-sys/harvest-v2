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
- First-load JS (route entry chunks listed in `page_client-reference-manifest.js` of a real `next build`, summed, raw / gzip, with the build run on main `5fd8a46` and on this branch):

| Route | main | this branch |
| --- | --- | --- |
| `/workspaces/[tenantId]/social/analytics` | not built (route absent) | 1,302,378 B / 394,002 B gzip (18 chunks) |
| `/workspaces/[tenantId]/social/planner` | 923,367 B / 286,616 B gzip | 928,069 B / 288,012 B gzip |
| `/workspaces/[tenantId]/crm/people` | 909,533 B / 282,527 B gzip | 914,145 B / 283,948 B gzip |

  The analytics route carries about 107 KB gzip more than the planner (recharts and the dashboard components). The two unrelated routes grew about 1.4 KB gzip each, from shared layout chunks (navigation registry entry and the added catalogue namespace), not from either library. The `motion` chunk (133 KB raw, 44 KB gzip) is in none of those entry lists; it loads only while an entrance plays. Both builds exited 0.

## Verified and not verified

Verified locally (synthetic data, local PostgreSQL 16, Chromium, fake provider):

- `npx tsc --noEmit` and `npm run lint` (ESLint plus source guards) clean. Unit project: 105 files, 1,364 tests passed (adds `tests/unit/social-analytics-view.test.ts` for the pure helpers and the navigation entry, and updates `navigation.test.ts` and the provenance record).
- One Playwright spec, `tests/e2e/social-analytics-screens.spec.ts` (1 test, passed): the route and the neutral 404 for a signed-in stranger; skeletons then data; reduced motion (`data-entrance="off"`, zero running animations, no `.animate-in` element, final numbers at once); unavailable shown as "Unavailable" for a Reddit-only scope; metric, top/bottom, heatmap source and range interactions; the 366-day rule; 44px targets at 390; expired and delayed banners; empty state; error then retry; the no-preference run (entrance `playing` then `done`, a filter change replays nothing); and no request other than GET during the visit. axe (WCAG 2 A/AA, 2.1 AA) and a no-horizontal-scroll check pass in light and dark at 1280 and 360 for: overview, heatmap, top posts, range filter open, post drawer, unavailable metrics, partial, empty. Each audit waits for the ready flag, the settled entrance and no skeleton or `aria-busy`.
- Screenshots (device scale 2, light and dark, 1280 and 360) were opened and read; none is blank or a skeleton.

Not verified or not built:

- No hosted Neon run, no real provider data or scopes, no production behaviour. The screen only works through the non-production gate.
- No rank-by selector, no CSV export, no comparison of platforms in one chart, no per-account series chart, no URL-persisted filters, no unit tests for the React components themselves (covered by the browser spec).
- Timezone is the browser's; there is no selector for another zone.
- Entrance timing was checked by state, not by frame capture; counts at 360 for the sparkline tooltips are hover-only.
- Nothing here is approved by the founder or an independent reviewer.
