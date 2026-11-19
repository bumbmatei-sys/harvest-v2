import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { eventCalendarFile, type CalendarEvent } from "../lib/event-calendar";
import { message } from "../i18n/messages";
import { withUser } from "./tenancy";
import { AccessError } from "./permissions";
import { communitiesEnabled } from "./communities-mode";
import { communityRoute } from "./community-route";

export function eventsEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" && communitiesEnabled(env);
}

const rsvpState = z.enum(["going", "maybe", "not_going", "waitlisted"]);
type State = z.infer<typeof rsvpState>;
type EventRecord = CalendarEvent & { timeZone: string; capacity: number | null; available: number | null; rsvp: State | null; rsvpVersion: number; canClaimSeat: boolean; reminderMinutes: number | null };
type RosterEntry = { userId: string; state: State; eligible: boolean };
type ReminderCandidate = { userId: string; eventVersion: number; rsvpVersion: number; dueAt: string };
type Action = "list" | "get" | "save" | "publish" | "cancel" | "rsvp" | "join" | "preview_join" | "roster" | "reminder_candidates";
type EventResponse<T> = { outcome: "ok"; data: T } | { outcome: "not_found" | "conflict" | "invalid" | "full" };
const uuid = z.uuid();
const datetime = z.iso.datetime({ offset: true });
const version = z.number().int().min(0).max(2_147_483_646);
const plainText = (value: string) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
export const eventSaveInput = z.object({
  version, title: z.string().trim().min(1).max(120).refine(plainText),
  description: z.string().max(4000).refine(plainText).default(""),
  timeZone: z.string().max(100).refine((value) => {
    if (!/^(?:UTC|[A-Za-z][A-Za-z0-9_+.\-]*(?:\/[A-Za-z0-9_+.\-]+)+)$/.test(value)) return false;
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }),
  startsAt: datetime, endsAt: datetime, capacity: z.number().int().positive().max(2_147_483_647).nullable().default(null),
  reminderMinutes: z.number().int().min(1).max(10_080).nullable().default(null),
  joinUrl: z.url({ protocol: /^https$/ }).max(2048).refine((value) => {
    const parsed = new URL(value);
    return !parsed.username && !parsed.password && !/[\s\\]/.test(value);
  }).nullable().default(null),
  joinWindowMinutes: z.number().int().min(0).max(1440).default(30),
}).strict().refine((v) => new Date(v.endsAt) > new Date(v.startsAt));

async function operate<T>(db: Database, user: string, tenantId: string, id: string | null, action: Action, body: object = {}): Promise<EventResponse<T>> {
  if (!eventsEnabled()) throw new AccessError(404, message("Errors.communityNotFound"));
  const tenant = uuid.parse(tenantId), eventId = id === null ? null : uuid.parse(id);
  return withUser(db, user, async (tx) => (await tx.execute<{ result: EventResponse<T> }>(
    sql`select public.events_operate(${tenant}::uuid,${eventId}::uuid,${action},${JSON.stringify(body)}::jsonb) as result`)).rows[0].result);
}

function resultData<T>(result: EventResponse<T>): T {
  if (result.outcome === "ok") return result.data;
  if (result.outcome === "not_found") throw new AccessError(404, message("Errors.communityNotFound"));
  throw new AccessError(result.outcome === "invalid" ? 400 : 409, message("Errors.thisRecordChangedReloadAndTryAgain"));
}
export async function listEvents(db: Database, user: string, tenantId: string, raw: unknown) {
  const range = z.object({ from: datetime, to: datetime }).strict().parse(raw);
  return resultData(await operate<EventRecord[]>(db, user, tenantId, null, "list", range));
}
export async function getEvent(db: Database, user: string, tenantId: string, id: string) {
  return resultData(await operate<EventRecord>(db, user, tenantId, id, "get"));
}
export async function saveEvent(db: Database, user: string, tenantId: string, id: string, raw: unknown) {
  const result = await operate<EventRecord>(db, user, tenantId, id, "save", eventSaveInput.parse(raw));
  return result.outcome === "full" ? { outcome: "full" as const } : { outcome: "ok" as const, event: resultData(result) };
}
export async function transitionEvent(db: Database, user: string, tenantId: string, id: string, raw: unknown) {
  const { action, ...input } = z.object({ action: z.enum(["publish", "cancel"]), version: version.min(1) }).strict().parse(raw);
  return resultData(await operate<EventRecord>(db, user, tenantId, id, action, input));
}
export async function rsvpEvent(db: Database, user: string, tenantId: string, id: string, raw: unknown) {
  const input = z.object({ state: rsvpState, expectedVersion: version }).strict().parse(raw);
  const result = await operate<EventRecord>(db, user, tenantId, id, "rsvp", input);
  return result.outcome === "full" ? { outcome: "full" as const } : { outcome: "ok" as const, event: resultData(result) };
}
export async function eventJoinLink(db: Database, user: string, tenantId: string, id: string, preview = false) {
  return resultData(await operate<{ url: string }>(db, user, tenantId, id, preview ? "preview_join" : "join"));
}
export async function eventRoster(db: Database, user: string, tenantId: string, id: string, after: string | null) {
  return resultData(await operate<RosterEntry[]>(db, user, tenantId, id, "roster", { after: z.string().min(1).max(255).nullable().parse(after) }));
}
/** Recipient metadata only. Delivery and deduplication are a separate job. */
export async function eventReminderCandidates(db: Database, user: string, tenantId: string, id: string, after: string | null) {
  const cursor = z.string().min(1).max(255).nullable().parse(after);
  return resultData(await operate<ReminderCandidate[]>(db, user, tenantId, id, "reminder_candidates", { after: cursor }));
}
export async function downloadEvent(db: Database, user: string, tenantId: string, id: string) {
  const event = await getEvent(db, user, tenantId, id);
  if (event.status === "draft") throw new AccessError(404, message("Errors.communityNotFound"));
  return new Response(eventCalendarFile(event, uuid.parse(tenantId)), { headers: {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `attachment; filename="event-${event.id}.ics"`,
    "Cache-Control": "private, no-store",
  } });
}

export function eventsRoute<P>(run: Parameters<typeof communityRoute<P>>[0], options: { write: boolean }) {
  const route = communityRoute(run, options);
  return (request: Request, context: { params: Promise<P> }) =>
    eventsEnabled() ? route(request, context) : Promise.resolve(new Response(null, { status: 404 }));
}
