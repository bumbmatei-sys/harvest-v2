# Community stats server acceptance (C21)

Read-only aggregate statistics for one community, server only, no screens, **no migration** (every figure is computed from existing community tables under the caller's tenant context, so FORCE RLS applies; the planned `community_analytics_daily` table is not needed for this slice). No gate beyond the existing Communities mode: nothing is sent, stored or exported. Sources read: `docs/prd/harvest-communities.md` section 16 (acquisition, engagement, retention, commerce, safety, privacy constraints), the route/table plan (`/communities/:id/analytics`, `community_analytics_daily`, `GET /api/communities/:id/analytics` "creator-only aggregates with role checks"), the C21 row (events/outbox), and the CRM reports and newsletter analytics privacy patterns (`src/lib/crm-reports.ts`, `src/server/crm-reports.ts`). Reused: the CRM UTC periods, atomic regions and small-group release rules, unchanged. Status and Evidence are filled after the build.

Real numbers only: a measure the system does not record is returned as `unavailable`, never as zero.

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Owner/admin only (`communities:manage`), neutral 404 for members, viewers, other ministries and other communities | | |
| 2 | Periods last 7, 30, 90 days, this month, last month (UTC), same as CRM reports | | |
| 3 | Small-group suppression: any figure with 1 to 4 in an atomic region is withheld ("fewer than 5"); totals and complementary suppression as in CRM reports | | |
| 4 | Members: active now, pending now, joined in period | | |
| 5 | Application funnel: started, approved, declined, approval percent, average hours to decision | | |
| 6 | Engagement: posts, visible comments, distinct contributors, unanswered posts | | |
| 7 | Safety: reports opened, resolved, average hours to resolve, open now | | |
| 8 | Acquisition (page views, join clicks, attribution) | | |
| 9 | Retention cohorts, cancellations and reasons, dormant alerts | | |
| 10 | Commerce, included-product use | | |
| 11 | Course progress, event participation, chat activity, moderator-level views | | |
| 12 | No individual is identifiable: no per-person rows, no names, no ids in the response | | |
| 13 | Read-only: no writes, no outbound, no export | | |

## Founder / product decisions recorded (not guessed)
1. **Suppression scope.** All counts use the CRM rule (1 to 4 withheld) because a small community is exactly where one person's activity would show. An owner can still see the underlying posts and members in the community itself; whether content totals should be exempt is a product call.
2. **Active contributors** (distinct people who posted or commented in the period) is the engagement figure instead of "active members": there is no recorded last-seen time, and adding one is a privacy decision. It is computed per period, not summed from regions, and withheld when 1 to 4.
3. **Retention and departures.** Memberships carry no leave time (`left` and `removed` have no timestamp), so cohorts, churn and cancellation reasons cannot be real numbers. They need a `left_at` column and a reasons design (migration, privacy review). Not built; returned as unavailable.
4. **Acquisition** needs page-view and join-click capture with consent and attribution rules; nothing records them today. Not built.
5. **Commerce** is out of scope while everything is free (16 Nov exception). **Chat** content tables are member-only under RLS; counting them needs a reviewed definer. **Course progress and event participation** need their own aggregate designs.
6. **Who may see stats.** Owner/admin only, as in the PRD's "creator-only aggregates". Moderators and members see nothing until the founder decides a role matrix.
