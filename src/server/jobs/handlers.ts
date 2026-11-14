import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Transaction } from "../../db/client";
import { externalWebhookEvents, jobs, outboxEvents, webhookResourceStates } from "../../db/schema";
import { crmEnvelope, crmEventTypes, type CrmEventEnvelope, type CrmEventType } from "../crm-events";
import { fanOutWebhookDeliveries } from "../crm-webhooks";
import { applySocialWebhook } from "../social/webhook-apply";
import { JobFailure } from "./primitives";

export type Job = typeof jobs.$inferSelect;
// Handlers must await all work and keep database effects in this transaction.
// No outbound effects are supported in Phase 1.
export type JobHandler = (tx: Transaction, job: Job) => Promise<void>;
export type JobHandlers = Readonly<Record<string, JobHandler>>;
const webhookPayload = z.object({ eventId: z.uuid() }).strict();
/**
 * CRM-08 consumer boundary. Every CRM event type has one job handler that rebuilds the typed envelope
 * from the outbox row (the stable event id), validates it against its contract, and hands it to each
 * subscriber that accepts the type, inside the job's transaction (so a failing subscriber retries the
 * whole event and no subscriber sees a half-applied one).
 *
 * Subscribers today: outbound CRM webhooks. Workflow automation and AI/context consumers are NOT
 * implemented yet; they register here when they exist (docs/acceptance/crm-08.md).
 */
export type CrmEventSubscriber = { name: string; accepts: (type: CrmEventType) => boolean; handle: (tx: Transaction, event: CrmEventEnvelope) => Promise<unknown> };
export const crmEventSubscribers: readonly CrmEventSubscriber[] = [
  { name: "crm-webhooks", accepts: () => true, handle: fanOutWebhookDeliveries },
];
export function crmEventHandler(subscribers: readonly CrmEventSubscriber[] = crmEventSubscribers): JobHandler {
  return async (tx, job) => {
    // Dispatched jobs are keyed outbox:<event id>; anything else did not come from the outbox.
    const source = /^outbox:([0-9a-f-]{36})$/.exec(job.idempotencyKey);
    if (!source) throw new JobFailure("INVALID_JOB_PAYLOAD");
    const [event] = await tx.select().from(outboxEvents).where(and(eq(outboxEvents.tenantId, job.tenantId), eq(outboxEvents.id, source[1])));
    // The job payload is the one that ran; the outbox supplies identity and time.
    const envelope = event && event.kind === job.kind ? crmEnvelope({ ...event, payload: job.payload as Record<string, unknown> }) : null;
    if (!envelope) throw new JobFailure("INVALID_JOB_PAYLOAD");
    for (const subscriber of subscribers) if (subscriber.accepts(envelope.type)) await subscriber.handle(tx, envelope);
  };
}
export function buildJobHandlers(subscribers: readonly CrmEventSubscriber[] = crmEventSubscribers): JobHandlers {
  const crm = crmEventHandler(subscribers);
  return { ...baseHandlers, ...Object.fromEntries(crmEventTypes.map((type) => [type, crm])) };
}
const baseHandlers: JobHandlers = {
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
  // Social provider events (src/server/social). Applies identifiers and fixed states only.
  "social.webhook": applySocialWebhook,
};
export const jobHandlers: JobHandlers = buildJobHandlers();
