import { fromLocalInput, toLocalInput, type EventItem } from "@/lib/event-view";

export const eventSteps = ["details", "schedule", "access"] as const;
export type EventStep = typeof eventSteps[number];
/** Reminder lead times offered in the form, in minutes; any other stored value is added as its own option. */
export const reminderPresets = [15, 60, 1440, 2880, 10080] as const;

export type EventFields = { title: string; description: string; timeZone: string; startsAt: string; endsAt: string; capacity: string; reminder: string; joinUrl: string };
export const emptyFields = (timeZone: string, now: Date): EventFields => {
  const start = new Date(Math.ceil((now.getTime() + 3_600_000) / 3_600_000) * 3_600_000);
  return { title: "", description: "", timeZone, startsAt: toLocalInput(start.toISOString(), timeZone), endsAt: toLocalInput(new Date(start.getTime() + 3_600_000).toISOString(), timeZone), capacity: "", reminder: "", joinUrl: "" };
};
export const fieldsOf = (event: EventItem, joinUrl: string): EventFields => ({ title: event.title, description: event.description, timeZone: event.timeZone,
  startsAt: toLocalInput(event.startsAt, event.timeZone), endsAt: toLocalInput(event.endsAt, event.timeZone),
  capacity: event.capacity === null ? "" : String(event.capacity), reminder: event.reminderMinutes === null ? "" : String(event.reminderMinutes), joinUrl });

export type FieldProblem = "title" | "start" | "end" | "order" | "capacity" | "join";
const httpsLink = (value: string) => { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !/[\s\\]/.test(value); } catch { return false; } };
export function fieldProblems(fields: EventFields): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (!fields.title.trim()) problems.push("title");
  const start = fromLocalInput(fields.startsAt, fields.timeZone), end = fromLocalInput(fields.endsAt, fields.timeZone);
  if (!start) problems.push("start");
  if (!end) problems.push("end");
  if (start && end && new Date(end) <= new Date(start)) problems.push("order");
  if (fields.capacity.trim() && !/^[1-9]\d{0,8}$/.test(fields.capacity.trim())) problems.push("capacity");
  if (fields.joinUrl.trim() && (!httpsLink(fields.joinUrl.trim()) || fields.joinUrl.trim().length > 2048)) problems.push("join");
  return problems;
}
/** The body the save route takes (version is added by the caller); null when the fields are not valid. */
export function saveBody(fields: EventFields) {
  if (fieldProblems(fields).length) return null;
  return { title: fields.title.trim(), description: fields.description, timeZone: fields.timeZone, startsAt: fromLocalInput(fields.startsAt, fields.timeZone)!, endsAt: fromLocalInput(fields.endsAt, fields.timeZone)!,
    capacity: fields.capacity.trim() ? Number(fields.capacity.trim()) : null, reminderMinutes: fields.reminder ? Number(fields.reminder) : null, joinUrl: fields.joinUrl.trim() || null };
}
export function timeZoneOptions(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set(["UTC", ...all, current])].sort((a, b) => a.localeCompare(b));
}
