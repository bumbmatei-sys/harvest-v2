import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { message } from "../i18n/messages";
import { uuidInput } from "../lib/contact-input";
import { leafTotal, percent, periodRegions, periodWindows, regionBounds, releaseRows, reportPeriods, reportSources, reportsMinistryScope,
  type ReportPeriod, type ReportRow, type ReportSource } from "../lib/crm-reports";
import { timeZoneOrDefault } from "../lib/time-zone";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

export type CrmReport = {
  period: ReportPeriod; scope: "ministry" | "own"; /** The ministry's IANA time zone: period boundaries and labels are in it. */ timeZone: string; generatedAt: string; window: { start: string; end: string }; minimumGroup: 5;
  /** Deals created in the period, by where they are now. A null is a withheld figure (fewer than 5). */
  deals: { created: number | null; won: number | null; open: number | null; lost: number | null; conversionPercent: number | null };
  /** Completed in the period (completion events), and a live snapshot of open tasks right now. */
  tasks: { completed: number | null; open: number | null; overdue: number | null; onTime: number | null };
  /** Ministry scope only. Credit goes to each contact's first source. */
  contacts?: { added: number | null; withDeal: number | null; sources: { source: ReportSource; added: number | null; withDeal: number | null }[] };
  /** Ministry scope only. Moves between neighbouring stages, tracked from `trackedFrom` (null: no move recorded yet). */
  stages?: { trackedFrom: string | null; pairs: StagePair[] };
};
/** One step between neighbouring stages of a pipeline. `moved` is withheld (null) under 5; the median time in the stage before the move is in days. */
export type StagePair = { pipelineId: string; pipeline: string; from: string; to: string; moved: number | null; medianDays: number | null };
type Cell = { region: number; key: string; leaf: string; n: number };

/** Rows of (region, key, leaf, n) into ReportRows, with every key present so a missing group reads as zero rather than absent. */
function toRows(cells: readonly Cell[], keys: readonly string[]): ReportRow[] {
  const rows = new Map<string, ReportRow>(keys.map((key) => [key, { key, leaves: {} }]));
  for (const cell of cells) {
    const row = rows.get(cell.key);
    if (!row) continue;
    (row.leaves[cell.leaf] ??= {})[cell.region] = cell.n;
  }
  return [...rows.values()];
}
const bound = (dates: Date[]) => sql`array[${sql.join(dates.map((date) => sql`${date.toISOString()}::timestamptz`), sql`, `)}]`;
const regionOf = (column: ReturnType<typeof sql>, bounds: ReturnType<typeof sql>) => sql`(select count(*) from unnest(${bounds}) as b(at) where b.at <= ${column})::int`;

/** Read-only aggregate report. Computed from existing tables under the caller's tenant context (FORCE RLS applies); no row-level data leaves this function. */
export function getCrmReport(db: Database, userId: string, workspace: string, periodInput: string, now = new Date()): Promise<CrmReport> {
  const period = reportPeriods.find((candidate) => candidate === periodInput);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:reports", async (tx, tenantId, role) => {
    if (!period) throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
    const [{ time_zone: zone } = { time_zone: "UTC" }] = (await tx.execute<{ time_zone: string }>(sql`select time_zone from public.workspaces where tenant_id = ${tenantId}::uuid`)).rows;
    const timeZone = timeZoneOrDefault(zone);
    const ministry = reportsMinistryScope(role), bounds = regionBounds(now, timeZone), bounded = bound(bounds), regions = periodRegions(period, now, timeZone);
    const window = periodWindows(now, timeZone)[period], first = bounds[0]!;
    const own = (column: ReturnType<typeof sql>) => ministry ? sql`true` : sql`${column} = ${userId}`;

    // Deals: cohort = deals created in the period, archived excluded, grouped by the stage kind they are in now (a reopened deal keeps its creation time).
    const dealCells = (await tx.execute<{ region: number; key: string; n: number }>(sql`
      select ${regionOf(sql`o.created_at`, bounded)} as region, st.kind as key, count(*)::int as n
      from public.opportunities o join public.crm_pipeline_stages st on st.tenant_id = o.tenant_id and st.pipeline_id = o.pipeline_id and st.id = o.stage_id
      where o.tenant_id = ${tenantId}::uuid and o.archived_at is null and o.created_at >= ${first.toISOString()}::timestamptz and o.created_at < ${now.toISOString()}::timestamptz
        and ${own(sql`o.owner_user_id`)}
      group by 1, 2`)).rows.map((row) => ({ ...row, leaf: "n" }));
    // Completed: one event per completion (audit), so a task reopened and completed again counts again. Archived tasks are excluded.
    const completedCells = (await tx.execute<{ region: number; n: number }>(sql`
      select ${regionOf(sql`a.created_at`, bounded)} as region, count(*)::int as n
      from public.audit_logs a join public.crm_tasks t on t.tenant_id = a.tenant_id and t.id::text = a.target_id
      where a.tenant_id = ${tenantId}::uuid and a.action = 'task.complete' and t.archived_at is null
        and a.created_at >= ${first.toISOString()}::timestamptz and a.created_at < ${now.toISOString()}::timestamptz and ${own(sql`t.assignee_user_id`)}
      group by 1`)).rows.map((row) => ({ region: row.region, key: "completed", leaf: "n", n: row.n }));
    // Overdue: a live snapshot of open tasks past due right now (single region 0).
    const openCells = (await tx.execute<{ key: string; n: number }>(sql`
      select case when t.due_at is not null and t.due_at < ${now.toISOString()}::timestamptz then 'overdue' else 'onTime' end as key, count(*)::int as n
      from public.crm_tasks t where t.tenant_id = ${tenantId}::uuid and t.status = 'open' and t.archived_at is null and ${own(sql`t.assignee_user_id`)}
      group by 1`)).rows.map((row) => ({ region: 0, key: row.key, leaf: "n", n: row.n }));

    const stageKinds = ["won", "open", "lost"], dealRows = toRows(dealCells, stageKinds), dealRelease = releaseRows(regions, dealRows);
    const dealTotal = dealRows.reduce((total, row) => total + leafTotal(regions, row, "n"), 0);
    const shownDeal = (key: string) => dealRelease.hidden.has(key) ? null : leafTotal(regions, dealRows.find((row) => row.key === key)!, "n");
    const won = shownDeal("won"), created = dealRelease.totalShown ? dealTotal : null;
    const completedRows = toRows(completedCells, ["completed"]), completedRelease = releaseRows(regions, completedRows);
    const openRows = toRows(openCells, ["overdue", "onTime"]), openRelease = releaseRows([0], openRows);
    const openTotal = openRows.reduce((total, row) => total + leafTotal([0], row, "n"), 0);
    const report: CrmReport = {
      period, scope: ministry ? "ministry" : "own", timeZone, generatedAt: now.toISOString(), minimumGroup: 5,
      window: { start: window.start.toISOString(), end: window.end.toISOString() },
      deals: { created, won, open: shownDeal("open"), lost: shownDeal("lost"), conversionPercent: created !== null && won !== null ? percent(won, created) : null },
      tasks: {
        completed: completedRelease.totalShown ? leafTotal(regions, completedRows[0]!, "n") : null, open: openRelease.totalShown ? openTotal : null,
        overdue: openRelease.hidden.has("overdue") ? null : leafTotal([0], openRows[0]!, "n"), onTime: openRelease.hidden.has("onTime") ? null : leafTotal([0], openRows[1]!, "n"),
      },
    };
    if (!ministry) return report;

    // Contacts: created in the period, erased contacts gone (a merge erases the merged person, so a merged pair counts once), credit to the person's
    // durable first source (kind and first-seen date, kept after the evidence expires); "with a deal" = an unarchived deal in an open or won stage.
    const contactCells = (await tx.execute<{ region: number; key: string; leaf: string; n: number }>(sql`
      select ${regionOf(sql`c.created_at`, bounded)} as region, coalesce(f.kind, 'unknown') as key,
        case when exists (select 1 from public.opportunities o join public.crm_pipeline_stages st on st.tenant_id = o.tenant_id and st.pipeline_id = o.pipeline_id and st.id = o.stage_id
          where o.tenant_id = c.tenant_id and o.contact_id = c.id and o.archived_at is null and st.kind in ('open', 'won')) then 'withDeal' else 'noDeal' end as leaf,
        count(*)::int as n
      from public.contacts c left join public.contact_first_sources f on f.tenant_id = c.tenant_id and f.contact_id = c.id
      where c.tenant_id = ${tenantId}::uuid and c.erased_at is null and c.created_at >= ${first.toISOString()}::timestamptz and c.created_at < ${now.toISOString()}::timestamptz
      group by 1, 2, 3`)).rows;
    const contactRows = toRows(contactCells, reportSources), contactRelease = releaseRows(regions, contactRows);
    const added = (row: ReportRow) => leafTotal(regions, row, "withDeal") + leafTotal(regions, row, "noDeal");
    report.contacts = {
      added: contactRelease.totalShown ? contactRows.reduce((total, row) => total + added(row), 0) : null,
      withDeal: contactRelease.totalShown ? contactRows.reduce((total, row) => total + leafTotal(regions, row, "withDeal"), 0) : null,
      sources: contactRows.map((row) => contactRelease.hidden.has(row.key) ? { source: row.key as ReportSource, added: null, withDeal: null }
        : { source: row.key as ReportSource, added: added(row), withDeal: leafTotal(regions, row, "withDeal") }),
    };
    report.stages = await stageMovement(tx, tenantId, { bounded, regions, window, now });
    return report;
  });
}

type Tx = Parameters<Parameters<typeof withTenant>[4]>[0];
/** Moves between neighbouring stages (forward, same pipeline; a step between two closed stages, such as Won to Lost, is not listed) of deals that are not archived. Counts use the same region suppression as the rest; the median is withheld with its row. */
async function stageMovement(tx: Tx, tenantId: string, scope: { bounded: ReturnType<typeof bound>; regions: number[]; window: { start: Date; end: Date }; now: Date }): Promise<NonNullable<CrmReport["stages"]>> {
  const { bounded, regions, window, now } = scope, first = sql`(select min(b.at) from unnest(${bounded}) as b(at))`;
  const tracked = (await tx.execute<{ at: Date | null }>(sql`select min(moved_at) as at from public.crm_deal_stage_moves where tenant_id = ${tenantId}::uuid`)).rows[0]?.at ?? null;
  const pairs = (await tx.execute<{ pipeline_id: string; pipeline: string; from_id: string; from_name: string; to_id: string; to_name: string }>(sql`
    with ordered as (select st.id, st.pipeline_id, st.name, st.kind, row_number() over (partition by st.pipeline_id order by st.position, st.id) as rn
      from public.crm_pipeline_stages st where st.tenant_id = ${tenantId}::uuid and st.archived_at is null)
    select p.id as pipeline_id, p.name as pipeline, f.id as from_id, f.name as from_name, t.id as to_id, t.name as to_name
    from ordered f join ordered t on t.pipeline_id = f.pipeline_id and t.rn = f.rn + 1
    join public.crm_pipelines p on p.tenant_id = ${tenantId}::uuid and p.id = f.pipeline_id
    where p.archived_at is null and not (f.kind <> 'open' and t.kind <> 'open') order by p.name, p.id, f.rn`)).rows;
  // Entered-at = the previous move of the same deal, or the deal's creation. Computed over all moves, then cut to the period.
  const moved = sql`
    select m.from_stage_id, m.to_stage_id, m.moved_at, extract(epoch from (m.moved_at - coalesce(lag(m.moved_at) over (partition by m.deal_id order by m.moved_at, m.id), o.created_at))) as seconds
    from public.crm_deal_stage_moves m join public.opportunities o on o.tenant_id = m.tenant_id and o.id = m.deal_id
    where m.tenant_id = ${tenantId}::uuid and o.archived_at is null`;
  const cells = (await tx.execute<{ region: number; key: string; n: number }>(sql`
    with moves as (${moved})
    select ${regionOf(sql`moves.moved_at`, bounded)} as region, moves.from_stage_id::text || '>' || moves.to_stage_id::text as key, count(*)::int as n
    from moves where moves.moved_at >= ${first} and moves.moved_at < ${now.toISOString()}::timestamptz group by 1, 2`)).rows.map((row) => ({ ...row, leaf: "n" }));
  const medians = new Map((await tx.execute<{ key: string; days: number | null }>(sql`
    with moves as (${moved})
    select moves.from_stage_id::text || '>' || moves.to_stage_id::text as key, percentile_cont(0.5) within group (order by moves.seconds) / 86400.0 as days
    from moves where moves.moved_at >= ${window.start.toISOString()}::timestamptz and moves.moved_at < ${window.end.toISOString()}::timestamptz group by 1`)).rows.map((row) => [row.key, row.days]));
  const keys = pairs.map((pair) => `${pair.from_id}>${pair.to_id}`), rows = toRows(cells, keys);
  // No total is published for this table, so only the row rule applies (complementary suppression exists to protect a published total).
  const hiddenKeys = new Set(rows.filter((row) => releaseRows(regions, [row]).hidden.has(row.key)).map((row) => row.key));
  return { trackedFrom: tracked ? new Date(tracked).toISOString() : null, pairs: pairs.map((pair, index) => {
    const key = keys[index]!, count = leafTotal(regions, rows[index]!, "n"), hidden = hiddenKeys.has(key);
    const median = medians.get(key);
    return { pipelineId: pair.pipeline_id, pipeline: pair.pipeline, from: pair.from_name, to: pair.to_name, moved: hidden ? null : count,
      medianDays: hidden || count === 0 || median == null ? null : Math.round(Number(median) * 10) / 10 };
  }) };
}
