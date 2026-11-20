# Social analytics server acceptance

Migration `0072_social_analytics` follows Auto-DM's `0071`. This draft stacks on #161 and must merge after it. Analytics is read-only. The refresh worker accepts an injected fake, the integration and vendor network constants remain hard-off, and no schedule is installed. All five HC-02 gates remain **UNAPPROVED**.

## Platform evidence

The table lists metrics that the documented provider path can supply. Metrics outside the table return unavailable. A listed metric can still be unavailable for a particular connection, scope, post type, provider delay, or date. Follower change is derived from follower snapshots. Scheduled publication counts use Harvest data and also include published external posts when organic analytics can identify them.

| Platform | Post metrics | Account metrics | Evidence |
| --- | --- | --- | --- |
| Instagram | Impressions, reach, views, likes, comments, shares, saves, video views, Reel watch time | Followers, profile views | [Instagram](https://docs.zernio.com/platforms/instagram) · [Account insights](https://docs.zernio.com/analytics/get-instagram-account-insights) |
| Facebook | Impressions, reach, views, reactions, comments, shares, link clicks where distinguishable, video views, Reel watch time where reported | Followers, Page views | [Facebook](https://docs.zernio.com/platforms/facebook) · [Page insights](https://docs.zernio.com/analytics/get-facebook-page-insights) · [Story mappings](https://docs.zernio.com/changelog) |
| X | Impressions, likes, replies, reposts, bookmarks, link clicks | Followers | [X](https://docs.zernio.com/platforms/twitter) |
| LinkedIn | Impressions, reach, reactions, comments, shares, personal saves, organization clicks, views on video posts | Followers, organization Page views | [LinkedIn](https://docs.zernio.com/platforms/linkedin) · [Organization aggregate analytics](https://docs.zernio.com/analytics/get-linkedin-org-aggregate-analytics) |
| TikTok | Views, likes, comments, shares, video views, Business-lane link clicks and watch time where distinguishable | Followers, profile views where the account insights scope allows them | [TikTok](https://docs.zernio.com/platforms/tiktok) · [Account insights](https://docs.zernio.com/analytics/get-tiktok-account-insights) · [Current SDK types](https://github.com/zernio-dev/zernio-node/blob/f98ece5fad2b1d07f4c328cb96cd87de52910997/src/generated/types.gen.ts) |
| YouTube | Views, video views, likes, comments, shares and watch time from daily video analytics | Subscribers as followers | [YouTube](https://docs.zernio.com/platforms/youtube) · [Daily video analytics](https://docs.zernio.com/analytics/get-youtube-daily-views) |
| Pinterest | Impressions, saves, clicks | Followers where the provider returns a follower series | [Pinterest](https://docs.zernio.com/platforms/pinterest) · [Follower stats](https://docs.zernio.com/accounts/get-follower-stats) |
| Reddit | Score and comment count | Unavailable | [Reddit](https://docs.zernio.com/platforms/reddit) |
| Bluesky | Likes, replies, reposts | Unavailable | [Bluesky](https://docs.zernio.com/platforms/bluesky) |
| Threads | Views, likes, replies, shares | Followers where the provider returns a follower series | [Threads](https://docs.zernio.com/platforms/threads) · [Follower stats](https://docs.zernio.com/accounts/get-follower-stats) |
| Snapchat | Views, unique viewers, shares on eligible Public Profiles | Unavailable | [Snapchat](https://docs.zernio.com/platforms/snapchat) |
| Google Business Profile | Unavailable | Unavailable for followers and profile views | [Platform matrix](https://docs.zernio.com/platforms#analytics-metrics) |
| Telegram, Discord, Slack, WhatsApp, iMessage | Unavailable | Unavailable | [Platform matrix](https://docs.zernio.com/platforms#analytics-metrics) |
| WordPress, Shopify, Wix, Webflow, RCS, LINE, WeChat, SMS | Unavailable | Unavailable | [Platform inventory](https://docs.zernio.com/platforms) |

The post listing pins platform and account ID and checks the matching platform entry before accepting a metric. Some generic response fields use zero for missing metrics. The adapter projects known fields, verifies LinkedIn account type for clicks and saves, and reads YouTube shares and watch seconds from the daily video endpoint. TikTok's general platform guide excludes watch time from the public API. The current generated contract documents a separate Business-lane value. Harvest accepts a positive value there and leaves ambiguous zeroes unavailable. The same omission applies to Facebook link clicks when a zero could be a Story placeholder and to non-Reel watch time where the adapter can't establish the media subtype. [Post analytics API](https://docs.zernio.com/core/analytics) · [Current SDK types](https://github.com/zernio-dev/zernio-node/blob/f98ece5fad2b1d07f4c328cb96cd87de52910997/src/generated/types.gen.ts)

The provider heatmap and list ranking are read-only and scoped by platform/account. The heatmap uses provider UTC slots with samples. Harvest also builds an observed heatmap from the displayed date range and timezone. [Best posting times API](https://docs.zernio.com/analytics/get-best-time-to-post)

## Screen contract

Owner or admin is required through `social:analytics`. Both routes return private, no-store responses and use a neutral 404 for an inaccessible ministry, account or planner delivery.

| Route | Result |
| --- | --- |
| `GET /api/workspaces/[tenantId]/social/analytics` | Cards, account and platform breakdowns, a selected metric time series, top and bottom posts, and heatmaps |
| `GET /api/workspaces/[tenantId]/social/analytics/posts/[postId]` | One visible published planner delivery with its account context, metrics and series |

Send inclusive `from` and `to` dates in `YYYY-MM-DD`, up to 366 days. Optional filters are `timezone` (IANA, default UTC), `connectionId`, `platform`, `metric`, and `rankBy`. The default series and ranking metric is engagement. All readings expose a numeric `value` with `availability` of `available`, `partial` or `unavailable`. Unavailable readings carry a null value. The exposure card names the first available measure among reach, impressions and views. Reach across posts is a sum of reported post reach and does not represent a deduplicated audience.

Post and publication timestamps use half-open local-day boundaries. Cumulative counters are differenced between observed snapshots, and the first observation of a post published within the interval starts at zero. Older posts require an observed baseline. Activity between observations appears on the day when the change was captured. Follower change uses the latest observation through the end of the range versus a prior observation. Provider account buckets keep their dates as returned. Engagement sums available likes, comments, shares and saves. Posts with a measured zero can rank. Posts without the selected metric are excluded from ranking. The scopes for provider and Harvest heatmaps and their UTC or selected timezone are included.

The response provides a connection status and latest completed refresh per account, plus overall freshness, partial and truncation flags and `Retry-After` when applicable. Partial results preserve available snapshots for delayed or expired connections. Poll with `If-None-Match`, reuse the previous data on 304, respect `Retry-After`, and pause polling when the screen is hidden. A report is bounded to 100 accounts and 12,000 rows per result stream and reports truncation if it reaches the cap. Use account or platform filters to narrow large reports.

## Storage and refresh

Four tables use composite ministry and connection foreign keys and FORCE RLS. Snapshot metric objects accept only allowlisted numeric keys. The planner FK additionally requires the same ministry and connection. The schema stores numeric observations, stable IDs, times, and fixed states. Provider post text, comments, participant details and raw responses are discarded.

Post snapshots are keyed by connection, provider post reference, and UTC capture day. Account and heatmap buckets are keyed by connection and day. Repeating a successful refresh upserts the same keys. The worker reads one bounded page per account, uses at most two accounts concurrently, continues paginated work on subsequent invocations, and honors provider backoff up to 24 hours. Vendor post date requests respect the documented 366-day fetch window. The retention pass deletes snapshots older than 397 UTC days in bounded repeatable batches, including their dependent heatmap rows. Leases are issued to `harvest_worker` only, and credentialed provider calls run after the claim transaction closes. A change to an account's authorization or version invalidates completion of an older lease.

## Verification

Lint and typecheck passed. The full unit project passed 1,318 tests in 102 files. The full integration project passed 935 tests in 111 files against local PostgreSQL. The focused stack run passed 20 tests covering Auto-DM and Analytics. Drizzle generated the snapshot and a second generation reported no schema changes. The journal still increases through 0070, 0071 and 0072.

Hosted Neon, real provider account scopes and responses, and production scheduling are unverified. No founder decision is required for the draft. A later activation review should confirm the refresh interval and scope-dependent availability.
