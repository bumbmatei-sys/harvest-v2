import { createHash } from "node:crypto";
import { z } from "zod";

export const jobInput = z.object({
  kind: z.string().min(1).max(100), idempotencyKey: z.string().min(1).max(200),
  payload: z.record(z.string(), z.json()),
  scheduledFor: z.date().optional(), maxAttempts: z.number().int().min(1).max(20).default(5),
}).strict();
export type JobInput = z.input<typeof jobInput>;
export const queueQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  status: z.enum(["queued", "running", "succeeded", "dead_letter"]).optional(),
});
export const LEASE_MS = 60_000;
export function backoffMs(attempt: number) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("INVALID_ATTEMPT");
  return Math.min(3_600_000, 1_000 * 2 ** Math.min(attempt - 1, 22));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function workFingerprint(kind: string, payload: Record<string, unknown>) {
  return createHash("sha256").update(canonical({ kind, payload })).digest("hex");
}
export function rawBodyHash(body: Uint8Array) { return createHash("sha256").update(body).digest("hex"); }
export type FailureCode = "HANDLER_FAILED" | "INVALID_JOB_PAYLOAD" | "UNSUPPORTED_JOB_KIND";
export class JobFailure extends Error {
  constructor(public code: FailureCode) { super(code); }
}
