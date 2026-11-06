import { z } from "zod";
import { CRM_TIME_ZONE } from "./crm-deals";

/**
 * CRM-05 shared model: tasks, notes and timeline paging. Pure and client-safe so the
 * UI and the server validate with the same rules.
 */
export const taskStatuses = ["open", "done"] as const;
export type TaskStatus = typeof taskStatuses[number];
export const taskPriorities = ["none", "low", "medium", "high"] as const;
export type TaskPriority = typeof taskPriorities[number];
export const TASK_PAGE_SIZE = 20;
export const NOTE_MAX = 10_000;
export const TASK_BODY_MAX = 5_000;
export const TIMELINE_PAGE_SIZE = 50;
export const RELATED_TASKS_LIMIT = 20;

/** Offset (minutes) of a time zone at an instant, e.g. +60 for Berlin in winter. */
function zoneOffset(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant.getTime()) / 60_000;
}
/** A wall-clock time in the CRM zone ("2026-11-06T17:00") as an instant. */
export function zonedToInstant(local: string, timeZone = CRM_TIME_ZONE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let instant = new Date(guess - zoneOffset(new Date(guess), timeZone) * 60_000);
  // Re-check once across a DST edge.
  instant = new Date(guess - zoneOffset(instant, timeZone) * 60_000);
  const back = instantToZoned(instant, timeZone);
  return back === local ? instant : null;
}
/** An instant as a wall-clock string in the CRM zone, for datetime-local inputs. */
export function instantToZoned(instant: Date, timeZone = CRM_TIME_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
/** Calendar day of an instant in the CRM zone (YYYY-MM-DD). */
export function zonedDay(instant: Date, timeZone = CRM_TIME_ZONE) { return instantToZoned(instant, timeZone).slice(0, 10); }

/** Open and due in the past. Done tasks are never overdue. */
export function isOverdue(status: TaskStatus, dueAt: Date | string | null, now = new Date()) {
  return status === "open" && dueAt !== null && new Date(dueAt).getTime() < now.getTime();
}
export type DueBucket = "overdue" | "today" | "upcoming" | "none";
export function dueBucket(status: TaskStatus, dueAt: Date | string | null, now = new Date()): DueBucket {
  if (dueAt === null) return "none";
  if (isOverdue(status, dueAt, now)) return "overdue";
  return zonedDay(new Date(dueAt)) === zonedDay(now) ? "today" : "upcoming";
}

const title = z.string().trim().min(1).max(200);
const body = z.string().max(TASK_BODY_MAX).transform((value) => value.replace(/\s+$/u, ""));
/** Due input: a Berlin wall-clock datetime-local value, an ISO instant, or "" to clear. */
const due = z.union([z.literal(""), z.null(), z.string().max(40)]).transform((value, context) => {
  if (!value) return null;
  const instant = /Z|[+-]\d{2}:\d{2}$/.test(value) ? new Date(value) : zonedToInstant(value);
  if (!instant || Number.isNaN(instant.getTime())) { context.addIssue({ code: "custom", message: "DUE" }); return z.NEVER; }
  return instant;
});
const optionalId = z.union([z.uuid(), z.literal(""), z.null()]).transform((value) => (value ? value : null));
const optionalUser = z.union([z.string().min(1).max(200), z.literal(""), z.null()]).transform((value) => value || null);
export const taskInput = z.object({
  title, body: body.default(""), priority: z.enum(taskPriorities).default("none"), dueAt: due.optional(),
  assigneeUserId: optionalUser.optional(), contactId: optionalId.optional(), companyId: optionalId.optional(), opportunityId: optionalId.optional(),
}).strict();
export const taskPatch = z.object({
  title: title.optional(), body: body.optional(), priority: z.enum(taskPriorities).optional(), dueAt: due.optional(),
  assigneeUserId: optionalUser.optional(), status: z.enum(taskStatuses).optional(),
  contactId: optionalId.optional(), companyId: optionalId.optional(), opportunityId: optionalId.optional(),
  archived: z.boolean().optional(), version: z.number().int().min(1),
}).strict();
export type TaskInput = z.input<typeof taskInput>;
export type TaskPatch = z.input<typeof taskPatch>;

export const noteTargets = ["person", "company", "deal"] as const;
export type NoteTarget = typeof noteTargets[number];
const noteBody = z.string().max(NOTE_MAX).refine((value) => value.trim().length > 0).transform((value) => value.replace(/\s+$/u, ""));
export const noteInput = z.object({ target: z.enum(noteTargets), targetId: z.uuid(), body: noteBody }).strict();
export const notePatch = z.object({ body: noteBody.optional(), archived: z.boolean().optional(), version: z.number().int().min(1) }).strict();
export type NoteInput = z.input<typeof noteInput>;
export type NotePatch = z.input<typeof notePatch>;

// ---------------------------------------------------------------------------
// Task list state (URL-backed). "me" is the default assignee filter.
export const taskSorts = ["due", "created", "updated", "priority", "title"] as const;
const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);
export const taskQuery = z.object({
  assignee: z.string().max(200).default("me"),
  status: z.enum(["open", "done", "all"]).default("open"),
  due: z.enum(["", "overdue", "today", "upcoming", "none"]).default(""),
  related: z.enum(["", "person", "company", "deal", "none"]).default(""),
  q: z.string().trim().max(100).default(""),
  sort: z.string().regex(new RegExp(`^-?(${taskSorts.join("|")})$`)).default("due"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
}).strict();
export type TaskQuery = z.output<typeof taskQuery>;
export const taskQueryKeys = ["assignee", "status", "due", "related", "q", "sort", "page"] as const;
export function parseTaskQuery(raw: Record<string, unknown>) {
  return taskQuery.safeParse(Object.fromEntries(taskQueryKeys.flatMap((key) => (raw[key] === undefined ? [] : [[key, one(raw[key])]]))));
}
export function taskQueryParams(query: TaskQuery) {
  const params = new URLSearchParams(), defaults = taskQuery.parse({});
  for (const key of taskQueryKeys) if (query[key] !== defaults[key]) params.set(key, String(query[key]));
  return params;
}

// ---------------------------------------------------------------------------
// Timeline paging: a cursor is the (time, id) of the last item shown. The time is the
// database's own microsecond-precision UTC text, so no two rows collapse into one.
export function encodeCursor(at: string, id: string) { return `${at}_${id}`; }
export function decodeCursor(cursor: string | null | undefined) {
  if (!cursor) return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)_([0-9a-f-]{36})$/.exec(cursor);
  return match ? { at: match[1], id: match[2] } : undefined;
}
