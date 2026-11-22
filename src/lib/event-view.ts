import { isSameMonth } from "date-fns";

/** Event as the Events API returns it (see src/server/events.ts). Times are instants; `timeZone` is where the event happens. */
export type EventState = "going" | "maybe" | "not_going" | "waitlisted";
export type EventItem = {
  id: string; title: string; description: string; timeZone: string; startsAt: string; endsAt: string; updatedAt: string;
  status: "draft" | "published" | "cancelled"; version: number; capacity: number | null; available: number | null;
  rsvp: EventState | null; rsvpVersion: number; canClaimSeat: boolean; reminderMinutes: number | null;
  /** Set by the cover routes; the picture itself is only ever read through the signed address the cover route returns. */
  coverFileId?: string | null;
};
export type EventPhase = "draft" | "cancelled" | "ended" | "live" | "upcoming";

/** Calendar entry in the shape of the kit calendar: `start` and `end` are wall-clock dates in the event's own time zone. */
export type CalendarEvent = { id: string; title: string; start: Date; end: Date; allDay?: boolean; status: EventItem["status"]; ended: boolean };

type Parts = { year: number; month: number; day: number; hour: number; minute: number };
function parts(ms: number, timeZone: string): Parts {
  const formatted = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(ms));
  const get = (type: string) => Number(formatted.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}
/** The date and time on a wall clock in `timeZone`, as a Date whose local fields carry them (so calendar maths never depends on the viewer's zone). */
export function wallClock(iso: string, timeZone: string): Date {
  const p = parts(new Date(iso).getTime(), timeZone);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute);
}
const pad = (value: number) => String(value).padStart(2, "0");
/** `YYYY-MM-DDTHH:mm` for a form field, on the wall clock of `timeZone`. */
export function toLocalInput(iso: string, timeZone: string): string {
  const p = parts(new Date(iso).getTime(), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
/** The instant (ISO, UTC) at which the wall clock of `timeZone` shows `local` (`YYYY-MM-DDTHH:mm`); null when `local` is not a date. */
export function fromLocalInput(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (ms: number) => { const p = parts(ms, timeZone); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60000) * 60000; };
  let guess = wall - offset(wall);
  guess = wall - offset(guess);
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}

export function eventPhase(event: Pick<EventItem, "status" | "startsAt" | "endsAt">, now: number): EventPhase {
  if (event.status === "draft") return "draft";
  if (event.status === "cancelled") return "cancelled";
  if (new Date(event.endsAt).getTime() <= now) return "ended";
  return new Date(event.startsAt).getTime() <= now ? "live" : "upcoming";
}
/** The widest join window the server allows is 24 hours before the start; the link itself is only ever returned inside the event's own window. */
export function mayAskForJoinLink(event: Pick<EventItem, "status" | "startsAt" | "endsAt">, now: number) {
  return event.status === "published" && new Date(event.endsAt).getTime() > now && new Date(event.startsAt).getTime() - 24 * 3_600_000 <= now;
}

const tag = (locale: string) => locale || "en";
export function formatDay(iso: string, timeZone: string, locale = "en") {
  return new Intl.DateTimeFormat(tag(locale), { timeZone, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
}
export function formatLongDay(iso: string, timeZone: string, locale = "en") {
  return new Intl.DateTimeFormat(tag(locale), { timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));
}
export function formatTime(iso: string, timeZone: string, locale = "en", zone = false) {
  return new Intl.DateTimeFormat(tag(locale), { timeZone, hour: "numeric", minute: "2-digit", ...(zone ? { timeZoneName: "short" as const } : {}) }).format(new Date(iso));
}
/** `9:00 AM – 10:30 AM EST`, in the event's own time zone. */
export function formatTimeRange(event: Pick<EventItem, "startsAt" | "endsAt" | "timeZone">, locale = "en") {
  return `${formatTime(event.startsAt, event.timeZone, locale)} – ${formatTime(event.endsAt, event.timeZone, locale, true)}`;
}
/** `YYYY-MM-DD` of the event's start in its own time zone: the key events are grouped by. */
export function dayKey(iso: string, timeZone: string) {
  const p = parts(new Date(iso).getTime(), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
export function groupByDay<T extends Pick<EventItem, "startsAt" | "timeZone">>(events: readonly T[]): { key: string; events: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const event of events) { const key = dayKey(event.startsAt, event.timeZone); groups.set(key, [...(groups.get(key) ?? []), event]); }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, list]) => ({ key, events: list }));
}

export const monthPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;
export function monthKey(date: Date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`; }
export function parseMonth(value: string | null | undefined, fallback: Date): Date {
  const match = value ? monthPattern.exec(value) : null;
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date(fallback.getFullYear(), fallback.getMonth(), 1);
}
export function shiftMonth(date: Date, by: number) { return new Date(date.getFullYear(), date.getMonth() + by, 1); }
/** API range for a month grid: a day of slack each side covers every time zone; the list API allows at most 100 days. */
export function monthRange(month: Date) {
  const from = new Date(Date.UTC(month.getFullYear(), month.getMonth(), 1) - 36 * 3_600_000), to = new Date(Date.UTC(month.getFullYear(), month.getMonth() + 1, 1) + 36 * 3_600_000);
  return { from: from.toISOString(), to: to.toISOString() };
}
export function toCalendarEvents(events: readonly EventItem[], now: number): CalendarEvent[] {
  return events.map((event) => ({ id: event.id, title: event.title, start: wallClock(event.startsAt, event.timeZone), end: wallClock(event.endsAt, event.timeZone), status: event.status,
    ended: new Date(event.endsAt).getTime() <= now }));
}
export function eventsInMonth(events: readonly CalendarEvent[], month: Date) { return events.filter((event) => isSameMonth(event.start, month) || isSameMonth(event.end, month)); }
export const eventDescriptionLimit = 4000;
