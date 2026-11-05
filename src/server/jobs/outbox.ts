import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { jobs, outboxEvents } from "../../db/schema";
import { message } from "../../i18n/messages";
import { AccessError } from "../permissions";
import { jobInput, workFingerprint, type JobInput } from "./primitives";

// Only call with a tenant transaction; RLS rejects a missing/mismatched context.
// Reserve infrastructure namespaces before attempting any application insert.
export async function enqueueJob(tx: Transaction, tenantId: string, data: JobInput) {
  if (/^(outbox|webhook):/.test(data.idempotencyKey)) throw new Error("RESERVED_JOB_KEY_PREFIX");
  return insertJob(tx, tenantId, data);
}
// Private to the dispatcher: producers must use enqueueJob above.
async function insertJob(tx: Transaction, tenantId: string, data: JobInput) {
  const input = jobInput.parse(data), fingerprint = workFingerprint(input.kind, input.payload);
  const [inserted] = await tx.insert(jobs).values({ ...input, tenantId, fingerprint }).onConflictDoNothing({ target: [jobs.tenantId, jobs.idempotencyKey] }).returning();
  const row = inserted ?? (await tx.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.idempotencyKey, input.idempotencyKey))))[0];
  if (!row || row.fingerprint !== fingerprint) throw new AccessError(409, message("Errors.jobIdempotencyConflict"));
  return row;
}
// Use in the SAME transaction as the domain/activity write. No separate connection.
export async function appendOutboxEvent(tx: Transaction, tenantId: string, data: Omit<JobInput, "maxAttempts">) {
  const parsed = jobInput.parse(data);
  const input = { kind: parsed.kind, idempotencyKey: parsed.idempotencyKey, payload: parsed.payload, scheduledFor: parsed.scheduledFor };
  if (input.idempotencyKey.length > 190) throw new Error("OUTBOX_KEY_TOO_LONG");
  const fingerprint = workFingerprint(input.kind, input.payload);
  const [inserted] = await tx.insert(outboxEvents).values({ ...input, tenantId, fingerprint }).onConflictDoNothing({ target: [outboxEvents.tenantId, outboxEvents.idempotencyKey] }).returning();
  const row = inserted ?? (await tx.select().from(outboxEvents).where(and(eq(outboxEvents.tenantId, tenantId), eq(outboxEvents.idempotencyKey, input.idempotencyKey))))[0];
  if (!row || row.fingerprint !== fingerprint) throw new AccessError(409, message("Errors.jobIdempotencyConflict"));
  return row;
}
export async function dispatchOutbox(tx: Transaction, tenantId: string, limit: number) {
  const events = await tx.select().from(outboxEvents).where(and(eq(outboxEvents.tenantId, tenantId), isNull(outboxEvents.dispatchedAt)))
    .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id)).limit(limit).for("update", { skipLocked: true });
  let dispatched = 0;
  for (const event of events) {
    try {
      // A failed enqueue or dispatch marker must roll back together without
      // aborting the batch, including when PostgreSQL aborts the savepoint.
      await tx.transaction(async (eventTx) => {
        await insertJob(eventTx, tenantId, { kind: event.kind, idempotencyKey: `outbox:${event.id}`, payload: event.payload as JobInput["payload"], scheduledFor: event.scheduledFor });
        await eventTx.update(outboxEvents).set({ dispatchedAt: sql`now()` }).where(and(eq(outboxEvents.tenantId, tenantId), eq(outboxEvents.id, event.id)));
      });
      dispatched++;
    } catch {
      // Leave this event pending for retry; never log its payload or error.
    }
  }
  return dispatched;
}
