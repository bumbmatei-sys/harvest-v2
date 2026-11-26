import { z } from "zod";
import { departmentKeys } from "./campaign-wizard";

// Pure rules for campaign boards, tasks and milestones. No imports from the server, so screens and services share them.
/** One board per included department, plus the campaign-wide board every campaign has. */
export const boardKeys = ["general", ...departmentKeys] as const;
export type BoardKey = typeof boardKeys[number];
/** The fixed Kanban columns, in board order. */
export const taskStatuses = ["todo", "in_progress", "done"] as const;
export type TaskStatus = typeof taskStatuses[number];

export const MAX_TASKS_PER_CAMPAIGN = 2000;
export const MAX_TASKS_PER_COLUMN = 500;
export const MAX_MILESTONES_PER_CAMPAIGN = 200;

const title = z.string().trim().min(1).max(200);
const notes = z.string().trim().max(5000);
const date = z.iso.date();
const uuid = z.uuid();
const position = z.number().int().min(0).max(MAX_TASKS_PER_COLUMN);

export const taskCreateInput = z.object({
  board: z.enum(boardKeys), title, notes: notes.optional().default(""),
  status: z.enum(taskStatuses).optional().default("todo"),
  assigneeId: z.string().min(1).max(200).nullish().transform((value) => value ?? null),
  dueDate: date.nullish().transform((value) => value ?? null),
  milestoneId: uuid.nullish().transform((value) => value ?? null),
}).strict();

/** A partial change. Leaving a field out keeps it; null clears an optional one. A move sets board and/or status, and optionally the position in the new column. */
export const taskUpdateInput = z.object({
  version: z.number().int().min(1),
  board: z.enum(boardKeys).optional(), status: z.enum(taskStatuses).optional(), position: position.optional(),
  title: title.optional(), notes: notes.optional(),
  assigneeId: z.string().min(1).max(200).nullable().optional(),
  dueDate: date.nullable().optional(),
  milestoneId: uuid.nullable().optional(),
}).strict();

export const milestoneCreateInput = z.object({
  board: z.enum(boardKeys).nullish().transform((value) => value ?? null), title,
  dueDate: date.nullish().transform((value) => value ?? null),
}).strict();
export const milestoneUpdateInput = z.object({
  version: z.number().int().min(1),
  board: z.enum(boardKeys).nullable().optional(), title: title.optional(), dueDate: date.nullable().optional(), reached: z.boolean().optional(),
}).strict();
export const versionInput = z.object({ version: z.number().int().min(1) }).strict();

/** Share of tasks done, as a whole percent; null when there are no tasks (never shown as zero). */
export function progressOf(done: number, total: number) {
  return total > 0 ? Math.floor((done / total) * 100) : null;
}
