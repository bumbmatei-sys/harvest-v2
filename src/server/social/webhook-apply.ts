import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { outboxEvents, socialConnections, socialInboxItems, socialPosts, socialWebhookEvents } from "../../db/schema";
import type { JobHandler } from "../jobs/handlers";
import { isMediaFetchFailure } from "./port";
import { deliveryKey } from "./types";
import { JobFailure } from "../jobs/primitives";

// Applies one stored webhook event inside the shared job transaction. Idempotent: an already-processed event does nothing.
// Inbox jobs advance activity metadata on known items; the next UI read loads the content live.
const payload = z.object({ eventId: z.uuid(), connectionId: z.uuid().optional(), reference: z.string().min(1).max(200).nullable().optional() }).strict();
export const applySocialWebhook: JobHandler = async (tx, job) => {
  const input = payload.safeParse(job.payload);
  const sourceId = /^outbox:([0-9a-f-]{36})$/.exec(job.idempotencyKey)?.[1];
  if (!input.success || !sourceId) throw new JobFailure("INVALID_JOB_PAYLOAD");
  const [source] = await tx.select().from(outboxEvents).where(and(eq(outboxEvents.tenantId, job.tenantId), eq(outboxEvents.id, sourceId),
    eq(outboxEvents.kind, "social.webhook"), eq(outboxEvents.idempotencyKey, `social-webhook:${input.data.eventId}`), isNotNull(outboxEvents.dispatchedAt)));
  if (!source || job.fingerprint !== source.fingerprint) throw new JobFailure("INVALID_JOB_PAYLOAD");
  const [event] = await tx.select().from(socialWebhookEvents).where(and(eq(socialWebhookEvents.tenantId, job.tenantId), eq(socialWebhookEvents.id, input.data.eventId))).for("update");
  if (!event || (input.data.connectionId !== undefined && input.data.connectionId !== event.connectionId)
      || (input.data.reference !== undefined && input.data.reference !== event.subjectRef)) throw new JobFailure("INVALID_JOB_PAYLOAD");
  if (event.processedAt) return;
  const bump = { updatedAt: sql`now()`, version: sql`${socialPosts.version} + 1` };
  const unlock = { lockToken: null, lockedAt: null };
  if ((event.eventType === "post.published" || event.eventType === "post.failed" || event.eventType === "post.partial") && event.subjectRef) {
    // A trusted provider event can settle a grouped delivery even if it arrived before the response.
    const correlation = event.detail.correlationKey;
    const where = and(eq(socialPosts.tenantId, job.tenantId), eq(socialPosts.connectionId, event.connectionId), inArray(socialPosts.status, ["publishing", "unknown"]),
      or(eq(socialPosts.providerPostRef, event.subjectRef), deliveryKey(correlation)
        ? and(isNull(socialPosts.providerPostRef), isNotNull(socialPosts.draftId), eq(socialPosts.idempotencyKey, correlation)) : undefined));
    const detail = { providerPostRef: event.subjectRef, ...unlock, ...bump };
    if (event.eventType === "post.published") await tx.update(socialPosts).set({ status: "published", publishedAt: sql`now()`, lastErrorCode: null, ...detail }).where(where);
    else await tx.update(socialPosts).set({ status: "failed", lastErrorCode: event.eventType === "post.partial" ? "PARTIAL_PUBLISH" :
      isMediaFetchFailure(event.detail.errorCategory) ? "MEDIA_FETCH_FAILED" : "PROVIDER_REJECTED", ...detail }).where(where);
  } else if (event.eventType === "account.disconnected") {
    await tx.update(socialConnections).set({ status: "revoked", health: "failing", healthCode: "account_disconnected", healthCheckedAt: sql`now()`, updatedAt: sql`now()`, version: sql`${socialConnections.version} + 1` })
      .where(and(eq(socialConnections.tenantId, job.tenantId), eq(socialConnections.id, event.connectionId), sql`${socialConnections.status} <> 'revoked'`));
  } else if (event.subjectRef && ["message.received", "comment.received", "mention.received"].includes(event.eventType)) {
    const kind = event.eventType === "comment.received" ? "comment" : event.eventType === "mention.received" ? "mention" : "dm";
    await tx.update(socialInboxItems).set({ activityAt: event.occurredAt, version: sql`${socialInboxItems.version} + 1` }).where(and(
      eq(socialInboxItems.tenantId, job.tenantId), eq(socialInboxItems.connectionId, event.connectionId),
      eq(socialInboxItems.providerRef, event.subjectRef), eq(socialInboxItems.kind, kind),
      sql`(${socialInboxItems.activityAt} is null or ${socialInboxItems.activityAt} < ${event.occurredAt.toISOString()}::timestamptz)`));
  }
  await tx.update(socialWebhookEvents).set({ processedAt: sql`now()` }).where(and(eq(socialWebhookEvents.tenantId, job.tenantId), eq(socialWebhookEvents.id, event.id)));
};
