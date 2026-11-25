import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { communities } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { message } from "../i18n/messages";
import { uuidInput } from "../lib/contact-input";
import { communityStatsUnavailable, type CommunityStats } from "../lib/community-stats";
import { leafTotal, percent, periodRegions, periodWindows, regionBounds, releaseRows, reportPeriods, SMALL_GROUP, type ReportRow } from "../lib/crm-reports";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

type Cell = { region: number; key: string; n: number };
const bound = (dates: Date[]) => sql`array[${sql.join(dates.map(date => sql`${date.toISOString()}::timestamptz`), sql`, `)}]`;
const regionOf = (column: ReturnType<typeof sql>, bounds: ReturnType<typeof sql>) => sql`(select count(*) from unnest(${bounds}) as b(at) where b.at <= ${column})::int`;
const toRows = (cells: readonly Cell[], keys: readonly string[]): ReportRow[] => {
  const rows = new Map<string, ReportRow>(keys.map(key => [key, { key, leaves: {} }]));
  for (const cell of cells) { const row = rows.get(cell.key); if (row) (row.leaves.n ??= {})[cell.region] = cell.n; }
  return [...rows.values()];
};
const safe = (n: number) => n === 0 || n >= SMALL_GROUP;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Aggregate statistics for one community: owners and admins only, read only, computed under the caller's tenant context (FORCE RLS applies). Nothing here is per person.
 * Every count follows the CRM reports suppression (a group of 1 to 4 in any atomic region withholds the figure; shown as null). Averages are published only when the group behind
 * them is at least 5. Measures that are never recorded are listed as unavailable, not reported as zero.
 */
export async function getCommunityStats(db: Database, userId: string, workspace: string, communityId: string, periodInput: string, now = new Date()): Promise<CommunityStats> {
  const period = reportPeriods.find(candidate => candidate === periodInput);
  const community = uuidInput.safeParse(communityId);
  return withTenant(db, userId, uuidInput.parse(workspace), "communities:manage", async (tx, tenantId) => {
    if (!period || !community.success) throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
    const [owned] = await tx.select({ id: communities.id }).from(communities).where(and(eq(communities.tenantId, tenantId), eq(communities.id, community.data)));
    if (!owned) throw new AccessError(404, message("Errors.workspaceUnavailable"));
    const id = community.data, bounds = regionBounds(now), bounded = bound(bounds), regions = periodRegions(period, now), window = periodWindows(now)[period], first = bounds[0]!;
    const from = first.toISOString(), to = now.toISOString(), start = window.start.toISOString(), end = window.end.toISOString();
    const scope = (alias: string) => sql`${sql.identifier(alias)}.tenant_id = ${tenantId}::uuid and ${sql.identifier(alias)}.community_id = ${id}::uuid`;
    const cells = async (query: ReturnType<typeof sql>) => (await tx.execute<Cell>(query)).rows;

    // Counted per atomic region so a published figure is always a sum of safe regions.
    const joined = await cells(sql`select ${regionOf(sql`m.joined_at`, bounded)} as region, 'joined' as key, count(*)::int as n from public.community_memberships m
      where ${scope("m")} and m.joined_at >= ${from}::timestamptz and m.joined_at < ${to}::timestamptz group by 1`);
    const started = await cells(sql`select ${regionOf(sql`a.created_at`, bounded)} as region, 'started' as key, count(*)::int as n from public.community_applications a
      where ${scope("a")} and a.created_at >= ${from}::timestamptz and a.created_at < ${to}::timestamptz group by 1`);
    const decided = await cells(sql`select ${regionOf(sql`a.decided_at`, bounded)} as region, a.status as key, count(*)::int as n from public.community_applications a
      where ${scope("a")} and a.status in ('approved','declined') and a.decided_at >= ${from}::timestamptz and a.decided_at < ${to}::timestamptz group by 1, 2`);
    const posts = await cells(sql`select ${regionOf(sql`p.created_at`, bounded)} as region, 'posts' as key, count(*)::int as n from public.community_posts p
      where ${scope("p")} and p.removed_at is null and p.held_at is null and p.created_at >= ${from}::timestamptz and p.created_at < ${to}::timestamptz group by 1`);
    const comments = await cells(sql`select ${regionOf(sql`c.created_at`, bounded)} as region, 'comments' as key, count(*)::int as n from public.community_comments c
      where ${scope("c")} and c.removed_at is null and c.held_at is null and c.created_at >= ${from}::timestamptz and c.created_at < ${to}::timestamptz group by 1`);
    const reports = await cells(sql`select ${regionOf(sql`r.created_at`, bounded)} as region, 'opened' as key, count(*)::int as n from public.community_reports r
      where ${scope("r")} and r.created_at >= ${from}::timestamptz and r.created_at < ${to}::timestamptz group by 1`);
    const resolved = await cells(sql`select ${regionOf(sql`r.decided_at`, bounded)} as region, 'resolved' as key, count(*)::int as n from public.community_reports r
      where ${scope("r")} and r.status in ('dismissed','actioned') and r.decided_at >= ${from}::timestamptz and r.decided_at < ${to}::timestamptz group by 1`);
    const snapshots = (await tx.execute<{ key: string; n: number }>(sql`
      select 'active' as key, count(*)::int as n from public.community_memberships m where ${scope("m")} and m.status = 'active'
      union all select 'pending', count(*)::int from public.community_memberships m where ${scope("m")} and m.status = 'pending'
      union all select 'unanswered', count(*)::int from public.community_posts p where ${scope("p")} and p.removed_at is null and p.held_at is null and p.created_at < ${to}::timestamptz - interval '24 hours' and p.created_at >= ${to}::timestamptz - interval '90 days'
        and not exists (select 1 from public.community_comments c where c.tenant_id = p.tenant_id and c.post_id = p.id and c.removed_at is null and c.held_at is null)
      union all select 'open', count(*)::int from public.community_reports r where ${scope("r")} and r.status = 'open'`)).rows;
    const snap = (key: string) => snapshots.find(row => row.key === key)?.n ?? 0;
    // Distinct people are not additive across regions: counted over the whole period and withheld when 1 to 4.
    const contributorsN = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from (
      select p.author_id from public.community_posts p where ${scope("p")} and p.removed_at is null and p.held_at is null and p.author_id is not null and p.created_at >= ${start}::timestamptz and p.created_at < ${end}::timestamptz
      union select c.author_id from public.community_comments c where ${scope("c")} and c.author_id is not null and c.removed_at is null and c.held_at is null
        and c.created_at >= ${start}::timestamptz and c.created_at < ${end}::timestamptz) x`)).rows[0]!.n;
    const hours = async (table: "community_applications" | "community_reports", statuses: readonly string[]) => (await tx.execute<{ n: number; hours: number | null }>(sql`
      select count(*)::int as n, avg(extract(epoch from (x.decided_at - x.created_at)) / 3600)::float8 as hours from public.${sql.identifier(table)} x
      where ${scope("x")} and x.status in (${sql.join(statuses.map(status => sql`${status}`), sql`, `)}) and x.decided_at >= ${start}::timestamptz and x.decided_at < ${end}::timestamptz`)).rows[0]!;

    // One release decision per family of figures, so complementary suppression applies inside the family.
    const family = (keys: readonly string[], source: readonly Cell[]) => {
      const rows = toRows(source, keys), release = releaseRows(regions, rows);
      return { value: (key: string) => release.hidden.has(key) ? null : leafTotal(regions, rows.find(row => row.key === key)!, "n"), total: release.totalShown ? rows.reduce((t, row) => t + leafTotal(regions, row, "n"), 0) : null };
    };
    const membersJoined = family(["joined"], joined), apps = family(["started"], started), decisions = family(["approved", "declined"], decided);
    const postsF = family(["posts"], posts), commentsF = family(["comments"], comments), opened = family(["opened"], reports), resolvedF = family(["resolved"], resolved);
    const snapshot = (key: string, label: string) => { const rows = toRows([{ region: 0, key: label, n: snap(key) }], [label]), release = releaseRows([0], rows); return release.hidden.has(label) ? null : snap(key); };
    const approved = decisions.value("approved"), declined = decisions.value("declined");
    const appHours = await hours("community_applications", ["approved", "declined"]), reportHours = await hours("community_reports", ["dismissed", "actioned"]);
    const decidedAll = decisions.total;

    return {
      communityId: id, period, timeZone: "UTC", generatedAt: now.toISOString(), minimumGroup: 5, window: { start, end },
      members: { active: snapshot("active", "active"), pending: snapshot("pending", "pending"), joined: membersJoined.value("joined") },
      applications: { started: apps.value("started"), approved, declined,
        approvalPercent: decidedAll !== null && approved !== null && decidedAll > 0 ? percent(approved, decidedAll) : null,
        averageHoursToDecision: appHours.hours !== null && appHours.n >= SMALL_GROUP && decidedAll !== null ? round1(appHours.hours) : null },
      engagement: { posts: postsF.value("posts"), comments: commentsF.value("comments"), contributors: safe(contributorsN) ? contributorsN : null, unansweredPosts: snapshot("unanswered", "unanswered") },
      safety: { reportsOpened: opened.value("opened"), reportsResolved: resolvedF.value("resolved"),
        averageHoursToResolve: reportHours.hours !== null && reportHours.n >= SMALL_GROUP && resolvedF.total !== null ? round1(reportHours.hours) : null, openNow: snapshot("open", "open") },
      unavailable: communityStatsUnavailable,
    };
  });
}
