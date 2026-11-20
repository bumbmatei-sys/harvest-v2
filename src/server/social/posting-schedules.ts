import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { socialPosts, socialSchedules } from "../../db/schema";
import type { WeeklySlot } from "../../lib/social/composer";
import { socialPlatforms, type SocialPlatform } from "../../lib/social/platforms";
import { storedText } from "../../lib/social/composer";
import { auditPublish, publishConflict, publishInvalid, recordId, unavailable, versionInput, withPublish } from "./publish-access";
import { defaultSocialDeps, type SocialDeps } from "./registry";

const dayMs = 86_400_000;
export const horizonDays = 366;
export const timezoneInput = z.string().min(1).max(80).refine(value => {
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
});
export const instantInput = z.iso.datetime({ offset: true });
const slot = z.object({ day: z.number().int().min(0).max(6), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/) }).strict();
const fields = z.object({
  name: storedText(120).refine(value => value.trim().length > 0).transform(value => value.trim()),
  timezone: timezoneInput,
  slots: z.array(slot).min(1).max(84).refine(slots => new Set(slots.map(slot => `${slot.day}/${slot.time}`)).size === slots.length),
});
const createInput = fields.extend({ platform: z.enum(socialPlatforms).nullable().default(null) }).strict();
const updateInput = fields.extend({ version: versionInput }).strict();
type Schedule = typeof socialSchedules.$inferSelect;
const asSchedule = ({ id, platform, name, timezone, slots, version, createdAt, updatedAt }: Schedule) =>
  ({ id, platform, name, timezone, slots, version, createdAt, updatedAt });

export function listPostingSchedules(db: Database, user: string, workspace: string, deps = defaultSocialDeps()) {
  return withPublish(db, user, workspace, deps, async (tx, tenantId) => {
    const rows = await tx.select().from(socialSchedules).where(and(eq(socialSchedules.tenantId, tenantId), isNull(socialSchedules.archivedAt)))
      .orderBy(asc(socialSchedules.platform), asc(socialSchedules.id));
    return { schedules: rows.map(asSchedule), defaultScheduleId: rows.find(row => row.platform === null)?.id ?? null };
  });
}
export function createPostingSchedule(db: Database, user: string, workspace: string, raw: unknown, deps = defaultSocialDeps()) {
  return withPublish(db, user, workspace, deps, async (tx, tenantId) => {
    const input = createInput.parse(raw);
    const [row] = await tx.insert(socialSchedules).values({ ...input, tenantId, createdBy: user }).onConflictDoNothing().returning();
    if (!row) throw publishConflict("SCHEDULE_SCOPE_EXISTS");
    await auditPublish(tx, tenantId, user, "social.schedule_create", row.id);
    return { schedule: asSchedule(row) };
  });
}
export function changePostingSchedule(db: Database, user: string, workspace: string, id: string, raw: unknown, remove = false, deps = defaultSocialDeps()) {
  return withPublish(db, user, workspace, deps, async (tx, tenantId) => {
    const update = remove ? null : updateInput.parse(raw);
    const requestedVersion = update?.version ?? z.object({ version: versionInput }).strict().parse(raw).version;
    const key = and(eq(socialSchedules.tenantId, tenantId), eq(socialSchedules.id, recordId(id)), isNull(socialSchedules.archivedAt));
    const [current] = await tx.select().from(socialSchedules).where(key).for("update");
    if (!current) throw unavailable();
    if (requestedVersion !== current.version) throw publishConflict();
    if (remove) {
      const [queued] = await tx.select({ id: socialPosts.id }).from(socialPosts).where(and(eq(socialPosts.tenantId, tenantId), eq(socialPosts.scheduleId, current.id),
        inArray(socialPosts.status, ["scheduled", "publishing"]))).limit(1);
      if (queued) throw publishConflict("SCHEDULE_HAS_QUEUE");
    }
    const [row] = await tx.update(socialSchedules).set({
      ...(update ? { name: update.name, timezone: update.timezone, slots: update.slots } : { archivedAt: sql`now()` }),
      version: requestedVersion + 1, updatedAt: sql`now()`,
    }).where(key).returning();
    await auditPublish(tx, tenantId, user, remove ? "social.schedule_archive" : "social.schedule_update", row.id);
    return { schedule: asSchedule(row), archived: remove };
  });
}

function wallClock(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, calendar: "iso8601", numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
function asLocalTimestamp(format: Intl.DateTimeFormat, milliseconds: number) {
  const parts = Object.fromEntries(format.formatToParts(milliseconds).map(part => [part.type, part.value]));
  return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
}
export function plannerDay(timezone: string, instant: Date) {
  const local = new Date(asLocalTimestamp(wallClock(timezone), instant.getTime()));
  const day = local.toISOString().slice(0, 10);
  const monday = new Date(local.getTime() - ((local.getUTCDay() + 6) % 7) * dayMs).toISOString().slice(0, 10);
  return { day, week: monday };
}

// Gaps are skipped and overlaps use the earlier occurrence. Weekly slots are wall-clock times.
export function nextPostingSlot(slots: WeeklySlot[], timezone: string, after: Date, occupied: ReadonlySet<number>) {
  const format = wallClock(timezone);
  const localDay = Math.floor(asLocalTimestamp(format, after.getTime()) / dayMs) * dayMs;
  const sorted = [...slots].sort((a, b) => a.time.localeCompare(b.time));
  for (let offset = 0; offset <= horizonDays; offset++) {
    const day = localDay + offset * dayMs;
    const weekday = new Date(day).getUTCDay();
    const offsets = [...new Set([-1, 0, 1].map(delta => {
      const stamp = day + delta * dayMs;
      return asLocalTimestamp(format, stamp) - stamp;
    }))];
    for (const slot of sorted.filter(slot => slot.day === weekday)) {
      const [hour, minute] = slot.time.split(":").map(Number);
      const wall = day + hour * 3_600_000 + minute * 60_000;
      const candidates = offsets.map(offset => wall - offset).filter(timestamp => asLocalTimestamp(format, timestamp) === wall);
      const instant = Math.min(...candidates);
      if (Number.isFinite(instant) && instant > after.getTime() && instant <= after.getTime() + horizonDays * dayMs && !occupied.has(instant)) return new Date(instant);
    }
  }
  return null;
}

export const targetInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("time"), scheduledFor: instantInput, timezone: timezoneInput }).strict(),
  z.object({ kind: z.literal("next"), scheduleId: z.uuid().optional() }).strict(),
]);
export type ScheduleTarget = z.infer<typeof targetInput>;
type Slot = { at: Date; timezone: string; scheduleId: string | null };

export async function allocateSlots(tx: Transaction, tenantId: string, platforms: SocialPlatform[], target: ScheduleTarget, deps: SocialDeps, draftId: string) {
  const now = deps.now();
  if (target.kind === "time") {
    const at = new Date(target.scheduledFor);
    if (at <= now || at.getTime() > now.getTime() + horizonDays * dayMs) throw publishInvalid("INVALID_SCHEDULE_TIME");
    return new Map(platforms.map(platform => [platform, { at, timezone: target.timezone, scheduleId: null }]));
  }
  const schedules = await tx.select().from(socialSchedules).where(and(eq(socialSchedules.tenantId, tenantId), isNull(socialSchedules.archivedAt),
    target.scheduleId ? eq(socialSchedules.id, target.scheduleId) : or(isNull(socialSchedules.platform), inArray(socialSchedules.platform, platforms))))
    .orderBy(socialSchedules.id).for("update");
  if (target.scheduleId && !schedules.length) throw unavailable();
  const chosen = new Map(platforms.map(platform => [platform, schedules.find(row => row.platform === platform) ?? schedules.find(row => row.platform === null)]));
  const allocations = new Map<string, Slot>();
  const result = new Map<SocialPlatform, Slot>();
  for (const [platform, schedule] of chosen) {
    if (!schedule) throw publishInvalid("SCHEDULE_UNAVAILABLE", { platform });
    const previous = allocations.get(schedule.id);
    if (previous) { result.set(platform, previous); continue; }
    const busy = await tx.selectDistinct({ scheduledFor: socialPosts.scheduledFor }).from(socialPosts)
      .where(and(eq(socialPosts.tenantId, tenantId), eq(socialPosts.scheduleId, schedule.id), gt(socialPosts.scheduledFor, now),
        ne(socialPosts.draftId, draftId), inArray(socialPosts.status, ["scheduled", "publishing", "published", "unknown"])));
    const at = nextPostingSlot(schedule.slots, schedule.timezone, now, new Set(busy.flatMap(row => row.scheduledFor ? [row.scheduledFor.getTime()] : [])));
    if (!at) throw publishConflict("NO_FREE_SLOT");
    const selected = { at, timezone: schedule.timezone, scheduleId: schedule.id };
    allocations.set(schedule.id, selected);
    result.set(platform, selected);
  }
  return result;
}
