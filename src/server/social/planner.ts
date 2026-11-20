import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { socialConnections, socialSchedules } from "../../db/schema";
import { socialPlatforms, type SocialPlatform } from "../../lib/social/platforms";
import { canRetry } from "./drafts";
import { horizonDays, instantInput, plannerDay, timezoneInput } from "./posting-schedules";
import { publishInvalid, recordId, unavailable, withPublish } from "./publish-access";
import { defaultSocialDeps } from "./registry";

const statuses = ["draft", "scheduled", "queued", "publishing", "published", "failed", "cancelled", "unknown"] as const;
const pagination = {
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(),
  limit: z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
};
const filters = { connectionId: z.uuid().optional(), platform: z.enum(socialPlatforms).optional() };
const plannerInput = z.object({
  from: instantInput, to: instantInput, timezone: timezoneInput, status: z.enum(statuses).optional(), ...filters, ...pagination,
}).strict();
const draftInput = z.object({ ...filters, ...pagination }).strict();
const queueInput = z.object(pagination).strict();
const cursorInput = z.tuple([instantInput, z.uuid()]);
function decode(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    const data = cursorInput.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    return [new Date(data[0]), data[1]] as const;
  } catch { throw publishInvalid("INVALID_CURSOR"); }
}
const encode = (date: Date, id: string) => Buffer.from(JSON.stringify([date.toISOString(), id])).toString("base64url");
type Filters = z.infer<typeof draftInput>;
type PlannerRow = {
  id: string; draftId: string | null; connectionId: string | null; scheduleId: string | null; platform: SocialPlatform | null;
  version: number; deliveryVersion: number | null; status: typeof statuses[number]; at: string; displayTimezone: string;
  type: string; summary: string; lastErrorCode: string | null; firstAttemptAt: string | null; providerPostRef: string | null; scheduledFor: string | null; publishedAt: string | null;
};

async function checkConnection(tx: Transaction, tenant: string, id: string | undefined) {
  if (id && !(await tx.select({ id: socialConnections.id }).from(socialConnections)
    .where(and(eq(socialConnections.tenantId, tenant), eq(socialConnections.id, id))).limit(1)).length) throw unavailable();
}
function draftMatches(tenant: string, input: Filters) {
  if (!input.connectionId && !input.platform) return sql`true`;
  return sql`exists (select 1 from public.social_connections c where c.tenant_id = ${tenant}
    and d.document->'connectionIds' ? c.id::text
    ${input.connectionId ? sql`and c.id = ${input.connectionId}::uuid` : sql``}
    ${input.platform ? sql`and c.platform = ${input.platform}` : sql``})`;
}
const plannerColumns = sql`
  p.id, p.draft_id as "draftId", p.connection_id as "connectionId", p.schedule_id as "scheduleId", c.platform,
  coalesce(d.version, p.version) as version, p.version as "deliveryVersion",
  case when p.status = 'scheduled' and p.schedule_id is not null then 'queued' else p.status end as status,
  date_trunc('milliseconds', coalesce(p.published_at, p.scheduled_for, p.created_at)) as at, p.display_timezone as "displayTimezone",
  p.last_error_code as "lastErrorCode", p.first_attempt_at as "firstAttemptAt", p.provider_post_ref as "providerPostRef",
  p.scheduled_for as "scheduledFor", p.published_at as "publishedAt",
  coalesce(p.delivery->>'type', 'post') as type, left(p.content, 200) as summary`;
const deliveryJoins = sql`from public.social_posts p join public.social_connections c on c.tenant_id = p.tenant_id and c.id = p.connection_id
  left join public.social_drafts d on d.tenant_id = p.tenant_id and d.id = p.draft_id`;
function plannerItem(row: PlannerRow, now: Date) {
  const { providerPostRef, firstAttemptAt, ...item } = row;
  return { ...item, at: new Date(row.at), scheduledFor: row.scheduledFor ? new Date(row.scheduledFor) : null,
    publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
    retryable: canRetry({ status: row.status === "queued" ? "scheduled" : row.status,
      firstAttemptAt: firstAttemptAt ? new Date(firstAttemptAt) : null, providerPostRef, lastErrorCode: row.lastErrorCode }, now), counters: null };
}

export function listPlanner(db: Database, user: string, workspace: string, raw: unknown, deps = defaultSocialDeps()) {
  return withPublish(db, user, workspace, deps, async (tx, tenant) => {
    const input = plannerInput.parse(raw);
    const from = new Date(input.from), to = new Date(input.to);
    if (from >= to || to.getTime() - from.getTime() > horizonDays * 86_400_000) throw publishInvalid("INVALID_PLANNER_RANGE");
    await checkConnection(tx, tenant, input.connectionId);
    const cursor = decode(input.cursor);
    const limit = input.limit ?? 50;
    const { rows } = await tx.execute<PlannerRow>(sql`
      select * from (
        select ${plannerColumns} ${deliveryJoins}
        where p.tenant_id = ${tenant}
          ${input.connectionId ? sql`and p.connection_id = ${input.connectionId}::uuid` : sql``}
          ${input.platform ? sql`and c.platform = ${input.platform}` : sql``}
          and coalesce(p.published_at, p.scheduled_for, p.created_at) >= ${from.toISOString()}::timestamptz
          and coalesce(p.published_at, p.scheduled_for, p.created_at) < ${to.toISOString()}::timestamptz
        union all
        select d.id, d.id as "draftId", null, null, null, d.version, null, 'draft', date_trunc('milliseconds', d.updated_at), ${input.timezone}, null, null, null, null, null, d.document->>'type', left(d.document->>'content', 200)
        from public.social_drafts d where d.tenant_id = ${tenant} and d.status = 'draft' and ${draftMatches(tenant, input)}
          and d.updated_at >= ${from.toISOString()}::timestamptz and d.updated_at < ${to.toISOString()}::timestamptz
      ) as entries where true
      ${input.status ? sql`and status = ${input.status}` : sql``}
      ${cursor ? sql`and (at, id) > (${cursor[0].toISOString()}::timestamptz, ${cursor[1]}::uuid)` : sql``}
      order by at, id limit ${limit + 1}`);
    const now = deps.now(), items = rows.slice(0, limit).map(row => plannerItem(row, now)).map(item => ({ ...item, ...plannerDay(input.timezone, item.at) }));
    const last = items.at(-1);
    const days: Record<string, typeof items> = {}, weeks: Record<string, typeof items> = {};
    for (const item of items) {
      (days[item.day] ??= []).push(item);
      (weeks[item.week] ??= []).push(item);
    }
    return { days, weeks, timezone: input.timezone, nextCursor: last && rows.length > limit ? encode(last.at, last.id) : null };
  });
}
export function listUnscheduledDrafts(db: Database, user: string, workspace: string, raw: unknown, deps = defaultSocialDeps()) {
  return withPublish(db, user, workspace, deps, async (tx, tenant) => {
    const input = draftInput.parse(raw);
    await checkConnection(tx, tenant, input.connectionId);
    const cursor = decode(input.cursor), limit = input.limit ?? 50;
    const { rows } = await tx.execute<{ id: string; type: string; version: number; connectionIds: string[]; updatedAt: string; summary: string }>(sql`
      select d.id, document->>'type' as type, d.version, document->'connectionIds' as "connectionIds",
        date_trunc('milliseconds', d.updated_at) as "updatedAt", left(d.document->>'content', 200) as summary
      from public.social_drafts d where d.tenant_id = ${tenant} and d.status = 'draft' and ${draftMatches(tenant, input)}
        ${cursor ? sql`and (date_trunc('milliseconds', d.updated_at), d.id) < (${cursor[0].toISOString()}::timestamptz, ${cursor[1]}::uuid)` : sql``}
      order by "updatedAt" desc, d.id desc limit ${limit + 1}`);
    const drafts = rows.slice(0, limit).map(row => ({ ...row, updatedAt: new Date(row.updatedAt) })), last = drafts.at(-1);
    return { drafts, nextCursor: last && rows.length > limit ? encode(last.updatedAt, last.id) : null };
  });
}
export function listScheduleQueue(db: Database, user: string, workspace: string, id: string, raw: unknown, deps = defaultSocialDeps()) {
  return withPublish(db, user, workspace, deps, async (tx, tenant) => {
    const input = queueInput.parse(raw);
    const [schedule] = await tx.select({ id: socialSchedules.id }).from(socialSchedules).where(and(eq(socialSchedules.tenantId, tenant),
      eq(socialSchedules.id, recordId(id)), isNull(socialSchedules.archivedAt)));
    if (!schedule) throw unavailable();
    const cursor = decode(input.cursor), limit = input.limit ?? 50;
    const { rows } = await tx.execute<PlannerRow>(sql`select ${plannerColumns} ${deliveryJoins} where p.tenant_id = ${tenant}
      and p.schedule_id = ${id} and p.status in ('scheduled', 'publishing')
      ${cursor ? sql`and (p.scheduled_for, p.id) > (${cursor[0].toISOString()}::timestamptz, ${cursor[1]}::uuid)` : sql``}
      order by p.scheduled_for, p.id limit ${limit + 1}`);
    const queue = rows.slice(0, limit).map(row => plannerItem(row, deps.now())), last = queue.at(-1);
    return { queue, nextCursor: last && rows.length > limit ? encode(last.at, last.id) : null };
  });
}
