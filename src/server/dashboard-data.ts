import { and, asc, desc, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { campaignBoards, campaigns, campaignTasks, communityMemberships, communityPosts, contacts, crmTasks, newsletterCampaigns,
  socialPosts, workspaces } from "../db/schema";
import { message } from "../i18n/messages";
import { permissionAreaOf } from "../lib/access-areas";
import { uuidInput } from "../lib/contact-input";
import { CONNECT_RETENTION_POLICY, suppressSmall } from "../lib/connect-retention";
import { dayKey } from "../lib/event-view";
import { can, type Permission } from "../lib/permissions";
import { timeZoneOrDefault } from "../lib/time-zone";
import { budgetSummaryOf } from "./campaign-budget";
import { communitiesEnabled } from "./communities-mode";
import { syntheticIntakeEnabled } from "./connect-intake-mode";
import { eventsEnabled } from "./events";
import { canAccessFeature } from "./feature-access";
import { campaignFundraisingOf, fundraisingEnabled } from "./fundraising";
import { newsletterEnabled } from "./newsletter";
import { periodRange } from "../lib/newsletter-analytics";
import { AccessError } from "./permissions";
import { SOCIAL_INTEGRATION_ENABLED } from "./social/registry";
import { withTenant } from "./tenancy";

type Point<T = number | null> = { date: string; value: T };
type UpcomingEvent = { id: string; title: string; startsAt: string; timeZone: string };
type Home = {
  timeZone: string;
  smallGroupLabel: string;
  peopleAdded?: Point[];
  giving?: { currency: string; raised: Point<string>[] }[];
  upcomingEvents?: UpcomingEvent[];
  community?: { posts: Point[]; newMembers: Point[] };
  newsletter?: { campaigns: { id: string; date: string; sends: number | null; clicks: number | null }[] };
  tasks?: { id: string; title: string; due: string | null; source: "crm" | "campaign" }[];
  social?: { scheduled: Point[] };
};
type CampaignSummary = {
  campaignId: string;
  smallGroupLabel: string;
  funding?: { currency: string; goal: Point<string>[]; raised?: Point<string>[] };
  connect?: { scans: Point[]; responses: Point[] };
  eventSignups?: Point[];
  tasks: { department: string; done: Point[]; open: Point[] }[];
  budget?: { currency: string; planned: Point<string>[]; spent: Point<string>[] };
};
const minimum = CONNECT_RETENTION_POLICY.smallGroupMin;
const mask = (n: number | null) => n === null || n < minimum ? null : suppressSmall(n);
const smallGroupLabel = () => message("CrmReports.hidden");
const utcDay = (date: Date) => date.toISOString().slice(0, 10);
const moveDay = (date: string, by: number) => utcDay(new Date(Date.parse(date) + by * 86_400_000));
const monday = (date: string) => moveDay(date, -((new Date(date).getUTCDay() + 6) % 7));
const monthStart = (date: string, offset = 0) => {
  const day = new Date(date);
  return utcDay(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + offset, 1)));
};

function allowed(tenant: string, access: string, permission: Permission) {
  if (!can(access, permission)) return false;
  const area = permissionAreaOf(permission);
  if (area === "workspace" || area === "owner_admin") return true;
  return canAccessFeature(tenant, { tenantId: tenant, access }, area, can("viewer", permission) ? "view" : "manage");
}

async function counts(tx: Transaction, dates: string[], query: SQL): Promise<Point[]> {
  const { rows } = await tx.execute<{ date: string; n: number }>(query);
  const cells = new Map(rows.map(row => [row.date, row.n]));
  return dates.map(date => ({ date, value: mask(cells.get(date) ?? 0) }));
}

async function eventsChart<T>(tx: Transaction, tenant: string, campaign: string | null, now: Date) {
  const { rows: [row] } = await tx.execute<{ result: T | null }>(sql`
    select public.workspace_event_chart(${tenant}::uuid,${campaign}::uuid,${now.toISOString()}::timestamptz) as result`);
  return row?.result ?? undefined;
}

async function newsletterChart(tx: Transaction, tenant: string, now: Date): Promise<NonNullable<Home["newsletter"]>> {
  const { from, until } = periodRange(90, now);
  const recent = await tx.execute<{ id: string; date: string }>(sql`
    select id, (frozen_at at time zone 'UTC')::date::text as date from ${newsletterCampaigns}
    where tenant_id=${tenant}::uuid and frozen_at is not null and state in ('sending','sent','partial','failed','cancelled')
    order by frozen_at desc,id desc limit 3`);
  const campaigns: NonNullable<Home["newsletter"]>["campaigns"] = [];
  for (const campaign of recent.rows) {
    const { rows: [row] } = await tx.execute<{ sends: number | null; clicks: number | null }>(sql`
      select case when bool_or(groups.counts is null) then null else sum((groups.counts->>'accepted')::int)::int end as sends,
        (public.newsletter_click_report(${tenant}::uuid,${campaign.id}::uuid,${from}::date,${until}::date)->>'total')::int as clicks
      from public.newsletter_analytics_groups(${tenant}::uuid,${campaign.id}::uuid,${from}::date,${until}::date) groups`);
    campaigns.push({ ...campaign, sends: mask(row.sends), clicks: mask(row.clicks) });
  }
  return { campaigns };
}

export function workspaceHome(db: Database, actor: string, workspace: string, now = new Date()): Promise<Home> {
  return withTenant(db, actor, uuidInput.parse(workspace), "workspace:read", async (tx, tenant, _role, access) => {
    const [ministry] = await tx.select({ tz: workspaces.timeZone }).from(workspaces).where(eq(workspaces.tenantId, tenant));
    const timeZone = timeZoneOrDefault(ministry?.tz);
    const today = dayKey(now.toISOString(), timeZone);
    const week = monday(today);
    const weeks = Array.from({ length: 12 }, (_, i) => moveDay(week, (i - 11) * 7));
    const from = weeks[0];
    const weekOf = (column: SQL) => sql`date_trunc('week', ${column} at time zone ${timeZone})::date::text`;
    const inWeeks = (column: SQL) => sql`${column} >= (${from}::timestamp at time zone ${timeZone}) and ${column} <= ${now.toISOString()}::timestamptz`;
    const may = (permission: Permission) => allowed(tenant, access, permission);
    const home: Home = { timeZone, smallGroupLabel: smallGroupLabel() };
    if (may("contacts:read")) {
      home.peopleAdded = await counts(tx, weeks, sql`
        select ${weekOf(sql`created_at`)} as date, count(*)::int as n from ${contacts}
        where tenant_id=${tenant}::uuid and erased_at is null and ${inWeeks(sql`created_at`)} group by 1`);
    }
    if (fundraisingEnabled() && may("giving:record")) {
      const thisMonth = monthStart(today), previousMonth = monthStart(today, -1);
      // A reversal offsets the original gift in the month it was attributed to.
      const { rows } = await tx.execute<{ currency: string; date: string; value: string }>(sql`
        select l.currency, date_trunc('month',coalesce(original.gift_date,l.gift_date))::date::text as date, sum(l.amount_cents)::text as value
        from public.giving_ledger_entries l left join public.giving_ledger_entries original
          on l.kind='reversal' and original.tenant_id=l.tenant_id and original.id=l.correction_of
        where l.tenant_id=${tenant}::uuid and coalesce(original.gift_date,l.gift_date) between ${previousMonth}::date and ${today}::date
        group by 1,2 order by 1,2`);
      const currencies = new Map<string, Map<string, string>>();
      for (const row of rows) {
        if (!currencies.has(row.currency)) currencies.set(row.currency, new Map());
        currencies.get(row.currency)!.set(row.date, row.value);
      }
      home.giving = [...currencies].map(([currency, totals]) => ({ currency,
        raised: [previousMonth, thisMonth].map(date => ({ date, value: totals.get(date) ?? "0" })) }));
    }
    if (eventsEnabled() && may("communities:read")) home.upcomingEvents = await eventsChart<UpcomingEvent[]>(tx, tenant, null, now);
    if (communitiesEnabled() && may("communities:manage")) {
      home.community = {
        posts: await counts(tx, weeks, sql`select ${weekOf(sql`created_at`)} as date, count(*)::int as n from ${communityPosts}
          where tenant_id=${tenant}::uuid and removed_at is null and held_at is null and ${inWeeks(sql`created_at`)} group by 1`),
        newMembers: await counts(tx, weeks, sql`select ${weekOf(sql`joined_at`)} as date, count(*)::int as n from ${communityMemberships}
          where tenant_id=${tenant}::uuid and ${inWeeks(sql`joined_at`)} group by 1`),
      };
    }
    if (newsletterEnabled() && may("newsletter:analytics")) home.newsletter = await newsletterChart(tx, tenant, now);
    if (may("tasks:read")) {
      const assigned = await tx.select({ id: crmTasks.id, title: crmTasks.title, due: crmTasks.dueAt }).from(crmTasks)
        .where(and(eq(crmTasks.tenantId, tenant), eq(crmTasks.assigneeUserId, actor), eq(crmTasks.status, "open"), isNull(crmTasks.archivedAt)))
        .orderBy(asc(crmTasks.dueAt), desc(crmTasks.createdAt), asc(crmTasks.id));
      home.tasks = assigned.map(row => ({ ...row, due: row.due?.toISOString() ?? null, source: "crm" }));
    }
    if (may("campaigns:read")) {
      const assigned = await tx.select({ id: campaignTasks.id, title: campaignTasks.title, due: campaignTasks.dueDate }).from(campaignTasks)
        .innerJoin(campaigns, and(eq(campaigns.tenantId, campaignTasks.tenantId), eq(campaigns.id, campaignTasks.campaignId)))
        .where(and(eq(campaignTasks.tenantId, tenant), eq(campaignTasks.assigneeId, actor), ne(campaignTasks.status, "done"), isNull(campaigns.archivedAt)))
        .orderBy(asc(campaignTasks.dueDate), desc(campaignTasks.createdAt), asc(campaignTasks.id));
      home.tasks = [...home.tasks ?? [], ...assigned.map(row => ({ ...row, source: "campaign" as const }))];
    }
    if (SOCIAL_INTEGRATION_ENABLED && may("social:schedule")) {
      const days = Array.from({ length: 7 }, (_, i) => moveDay(week, i));
      const end = moveDay(week, 7);
      home.social = { scheduled: await counts(tx, days, sql`
        select (scheduled_for at time zone ${timeZone})::date::text as date, count(*)::int as n from ${socialPosts}
        where tenant_id=${tenant}::uuid and status='scheduled' and scheduled_for >= (${week}::timestamp at time zone ${timeZone})
          and scheduled_for < (${end}::timestamp at time zone ${timeZone}) group by 1`) };
    }
    return home;
  });
}

export function campaignSummary(db: Database, actor: string, workspace: string, campaign: string, now = new Date()): Promise<CampaignSummary> {
  const campaignId = uuidInput.parse(campaign);
  return withTenant(db, actor, uuidInput.parse(workspace), "campaigns:read", async (tx, tenant, _role, access) => {
    const [owned] = await tx.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.tenantId, tenant), eq(campaigns.id, campaignId)));
    if (!owned) throw new AccessError(404, message("Campaigns.notFound"));
    const date = utcDay(now), point = <T>(value: T) => [{ date, value }];
    const departments = await tx.select({ department: campaignBoards.department,
      done: sql<number>`count(${campaignTasks.id}) filter (where ${campaignTasks.status}='done')::int`,
      open: sql<number>`count(${campaignTasks.id}) filter (where ${campaignTasks.status}<>'done')::int` })
      .from(campaignBoards).leftJoin(campaignTasks, and(eq(campaignTasks.tenantId, campaignBoards.tenantId),
        eq(campaignTasks.campaignId, campaignBoards.campaignId), eq(campaignTasks.boardId, campaignBoards.id)))
      .where(and(eq(campaignBoards.tenantId, tenant), eq(campaignBoards.campaignId, campaignId)))
      .groupBy(campaignBoards.department).orderBy(campaignBoards.department);
    const result: CampaignSummary = { campaignId, smallGroupLabel: smallGroupLabel(),
      tasks: departments.map(row => ({ department: row.department, done: point(mask(row.done)), open: point(mask(row.open)) })) };
    const budget = await budgetSummaryOf(tx, tenant, campaignId);
    if (budget) result.budget = { currency: budget.currency, planned: point(budget.plannedCents), spent: point(budget.spentCents) };
    if (fundraisingEnabled() && allowed(tenant, access, "fundraising:read")) {
      const { fundraising } = await campaignFundraisingOf(tx, tenant, campaignId, access);
      if (fundraising) result.funding = { currency: fundraising.currency, goal: point(fundraising.goalCents),
        ...(fundraising.totals ? { raised: point(fundraising.totals.raisedCents) } : {}) };
    }
    if (syntheticIntakeEnabled() && allowed(tenant, access, "connect:publish")) {
      const { rows: [row] } = await tx.execute<{ result: CampaignSummary["connect"] | null }>(sql`
        select public.connect_campaign_chart(${tenant}::uuid,${campaignId}::uuid) as result`);
      if (row?.result) result.connect = row.result;
    }
    if (eventsEnabled() && allowed(tenant, access, "communities:manage")) result.eventSignups = await eventsChart<Point[]>(tx, tenant, campaignId, now);
    return result;
  });
}
