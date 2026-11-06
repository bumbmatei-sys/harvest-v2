import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Transaction } from "../../db/client";
import { externalWebhookEvents, jobs, webhookResourceStates } from "../../db/schema";
import { JobFailure } from "./primitives";

export type Job = typeof jobs.$inferSelect;
// Handlers must await all work and keep database effects in this transaction.
// No outbound effects are supported in Phase 1.
export type JobHandler = (tx: Transaction, job: Job) => Promise<void>;
export type JobHandlers = Readonly<Record<string, JobHandler>>;
const webhookPayload = z.object({ eventId: z.uuid() }).strict();
export const jobHandlers: JobHandlers = {
  "webhook.synthetic": async (tx, job) => {
    const input = webhookPayload.safeParse(job.payload);
    if (!input.success) throw new JobFailure("INVALID_JOB_PAYLOAD");
    const [event] = await tx.select().from(externalWebhookEvents).where(and(eq(externalWebhookEvents.tenantId, job.tenantId), eq(externalWebhookEvents.id, input.data.eventId)));
    if (!event) throw new JobFailure("INVALID_JOB_PAYLOAD");
    // The unique resource key serializes concurrent deliveries. Sequence, not
    // arrival time, determines which event can update the synthetic projection.
    await tx.insert(webhookResourceStates).values({ tenantId: job.tenantId, provider: event.provider, connectionId: event.connectionId,
      resourceId: event.resourceId, sequence: event.sequence, eventId: event.id, payload: event.payload,
    }).onConflictDoUpdate({
      target: [webhookResourceStates.tenantId, webhookResourceStates.provider, webhookResourceStates.connectionId, webhookResourceStates.resourceId],
      set: { sequence: event.sequence, eventId: event.id, payload: event.payload, updatedAt: sql`now()` },
      setWhere: sql`${webhookResourceStates.sequence} < ${event.sequence}`,
    });
  },
  // Domain events can safely enter the queue before consumers are released.
  // A deliberate no-op receipt is the entire Phase 1 domain handler.
  "domain.receipt": async () => {},
  // CRM-05 domain events: receipts only until automation consumers exist (CRM-08).
  "crm.task.created": async () => {},
  "crm.task.updated": async () => {},
  "crm.task.completed": async () => {},
  "crm.task.reassigned": async () => {},
  "crm.note.created": async () => {},
  "crm.note.updated": async () => {},
  "crm.note.archived": async () => {},
  // CRM-07: receipt only (ids and categories); consumers come later.
  "crm.association.recorded": async () => {},
};
