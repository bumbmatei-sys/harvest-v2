// Browser side of the Office routes for the personal calendar (docs/acceptance/office-server.md: `calendars`, `events`, `availability`, `eventLink`). Events are live
// pass-through: titles, attendees and details are held in component state only, never stored by Harvest and never written to browser storage. Create, edit and delete
// have no call here: the server answers `disabled` for them while OFFICE_CALENDAR_WRITE_ENABLED is false.
import { addDays, addMinutes, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { call, type Connected, type Failure, type OfficeOverview, type OfficePlatform, type Page, type Pending, type Result } from "@/lib/office/mail";
import type { CalendarEvent } from "@/lib/event-view";
import type { PlannerItem } from "@/lib/social/api";

export type CalendarView = "month" | "week" | "day" | "agenda" | "availability";
export const calendarViews: readonly CalendarView[] = ["month", "week", "day", "agenda", "availability"];
/** Days the agenda lists from its start date (the kit's AgendaDaysToShow). */
export const agendaDays = 30;
export type NamedCalendar = { ref: string; name: string; primary?: boolean; readOnly?: boolean; timezone?: string | null };
/** One provider event as the `events` and `event` actions return it (`EventDetail` on the server); optional fields are absent when the provider does not report them. */
export type CalendarItem = { ref: string; calendarRef: string; title: string; description?: string; start: string; end: string; allDay?: boolean; attendees: string[]; meetingLink: string | null; meetingKind?: "meet" | "teams" };
export type Slot = { start: string; end: string };
export type Reference = { ref: string; kind: string; name: string | null; startsAt: string | null; endsAt: string | null };

export const calendarApi = (tenantId: string) => {
  const run = <T,>(action: string, connectionId: string | undefined, input: unknown, signal?: AbortSignal) =>
    call<Result<T>>(tenantId, { method: "POST", signal, body: { action, ...(connectionId ? { connectionId } : {}), input } });
  return {
    overview: (signal?: AbortSignal) => call<OfficeOverview>(tenantId, { method: "GET", signal }),
    startConnect: (platform: OfficePlatform, noticeVersion: number, connectionId?: string) =>
      call<Pending | { state: Failure }>(tenantId, { method: "POST", body: { action: "startConnect", ...(connectionId ? { connectionId } : {}), input: { kind: "calendar", platform, noticeVersion } } }),
    finishConnect: (attemptId: string) => call<Connected | { state: "pending" | "failed" }>(tenantId, { method: "POST", body: { action: "finishConnect", input: { attemptId } } }),
    health: (connectionId: string) => call<{ state: string }>(tenantId, { method: "POST", body: { action: "health", connectionId, input: {} } }),
    disconnect: (connectionId: string) => call<{ state: string }>(tenantId, { method: "POST", body: { action: "disconnect", connectionId, input: {} } }),
    calendars: (id: string, signal?: AbortSignal) => run<{ items: NamedCalendar[] }>("calendars", id, {}, signal),
    events: (id: string, input: { start: string; end: string; calendarRef?: string; cursor?: string; limit?: number }, signal?: AbortSignal) => run<Page<CalendarItem>>("events", id, input, signal),
    event: (id: string, input: { eventRef: string; calendarRef?: string }, signal?: AbortSignal) => run<CalendarItem>("event", id, input, signal),
    availability: (id: string, input: { start: string; end: string; durationMinutes: number }, signal?: AbortSignal) => run<{ items: Slot[]; partial?: boolean }>("availability", id, input, signal),
    link: (id: string, input: { eventRef: string; calendarRef?: string; contactId: string }) => run<Reference>("eventLink", id, input),
    unlink: (id: string, input: { contactId: string; itemRef: string }) => run<{ removed: true }>("removeReference", id, input),
  };
};
export type CalendarApi = ReturnType<typeof calendarApi>;

/** Provider names for the connect buttons and the source chips. Product names live here and in the logo registry, never in the message catalogue. */
export const calendarLabel: Record<OfficePlatform, string> = { google: "Google Calendar", microsoft: "Outlook" };
export const platformName: Record<OfficePlatform, "google" | "outlook"> = { google: "google", microsoft: "outlook" };

/** Social posts the overlay shows: the ones still to go out. Drafts and finished or cancelled posts are not on the Calendar overlay. */
export const overlayStatuses: ReadonlySet<string> = new Set(["scheduled", "queued", "publishing"]);

/** The window a view reads. Monday first, like the Social planner; the month window is the visible grid (at most 42 days; the server allows 93). */
export function rangeFor(view: CalendarView, date: Date): { from: Date; to: Date } {
  if (view === "month") return { from: startOfWeek(startOfMonth(date), { weekStartsOn: 1 }), to: addDays(endOfWeek(endOfMonth(date), { weekStartsOn: 1 }), 1) };
  if (view === "day") return { from: startOfDay(date), to: addDays(startOfDay(date), 1) };
  if (view === "agenda") return { from: startOfDay(date), to: addDays(startOfDay(date), agendaDays) };
  const from = startOfWeek(date, { weekStartsOn: 1 });
  return { from, to: addDays(from, 7) };
}
export function shiftDate(view: CalendarView, date: Date, by: -1 | 1): Date {
  if (view === "month") return new Date(date.getFullYear(), date.getMonth() + by, 1);
  return addDays(date, by * (view === "day" ? 1 : view === "agenda" ? agendaDays : 7));
}

const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A provider all-day value is a plain date: it is a local calendar day, never an instant. */
function parseWhen(value: string): { date: Date; plain: boolean } {
  const match = dateOnly.exec(value);
  return match ? { date: new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])), plain: true } : { date: new Date(value), plain: false };
}
export function calendarEvent(item: CalendarItem, now: number): CalendarEvent {
  const start = parseWhen(item.start), end = parseWhen(item.end);
  const allDay = item.allDay === true || start.plain;
  // A plain end date is exclusive (the day after the last day): the last day shown is the one before it.
  const last = end.plain && end.date > start.date ? new Date(end.date.getTime() - 60_000) : end.plain ? addMinutes(end.date, 24 * 60 - 1) : end.date;
  return { id: `cal:${item.calendarRef}:${item.ref}`, title: item.title, start: start.date, end: last, allDay, status: "published", ended: last.getTime() <= now };
}
export function socialEvent(item: PlannerItem, now: number): CalendarEvent {
  const start = new Date(item.at);
  return { id: `social:${item.id}`, title: item.summary.trim().slice(0, 60), start, end: addMinutes(start, 30), status: "published", ended: start.getTime() < now };
}
export const isSocialId = (id: string) => id.startsWith("social:");

export function plannerHref(tenantId: string, item: Pick<PlannerItem, "at">) {
  const at = new Date(item.at), pad = (n: number) => String(n).padStart(2, "0");
  const monday = startOfWeek(at, { weekStartsOn: 1 });
  return `/workspaces/${tenantId}/social/planner?view=calendar&mode=week&week=${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

/** The first link in a provider's join field only when it is a web address. */
export const safeLink = (value: string | null | undefined) => { try { const url = new URL(value ?? ""); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null; } catch { return null; } };
