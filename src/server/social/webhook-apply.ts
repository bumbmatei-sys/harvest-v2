import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { socialConnections, socialPosts, socialWebhookEvents } from "../../db/schema";
import type { JobHandler } from "../jobs/handlers";
import { JobFailure } from "../jobs/primitives";

// Applies one stored webhook event inside the shared job transaction. Idempotent: an already-processed event does nothing.
// Only identifiers and fixed states are used; message and comment content was never stored. Inbox events are recorded and
// otherwise ignored until the inbox feature exists.
const payload = z.object({ eventId: z.uuid() }).strict();
export const applySocialWebhook: JobHandler = async (tx, job) => {
  const input = payload.safeParse(job.payload);
  if (!input.success) throw new JobFailure("INVALID_JOB_PAYLOAD");
  const [event] = await tx.select().from(socialWebhookEvents).where(and(eq(socialWebhookEvents.tenantId, job.tenantId), eq(socialWebhookEvents.id, input.data.eventId))).for("update");
  if (!event) throw new JobFailure("INVALID_JOB_PAYLOAD");
  if (event.processedAt) return;
  const bump = { updatedAt: sql`now()`, version: sql`${socialPosts.version} + 1` };
  const unlock = { lockToken: null, lockedAt: null };
  if ((event.eventType === "post.published" || event.eventType === "post.failed" || event.eventType === "post.partial") && event.subjectRef) {
    // Only a post that was accepted by the provider and is awaiting its final answer can move; anything else is already settled.
    const where = and(eq(socialPosts.tenantId, job.tenantId), eq(socialPosts.connectionId, event.connectionId), eq(socialPosts.providerPostRef, event.subjectRef), eq(socialPosts.status, "publishing"));
    if (event.eventType === "post.published") await tx.update(socialPosts).set({ status: "published", publishedAt: sql`now()`, lastErrorCode: null, ...unlock, ...bump }).where(where);
    else await tx.update(socialPosts).set({ status: "failed", lastErrorCode: event.eventType === "post.partial" ? "PARTIAL_PUBLISH" : "PROVIDER_REJECTED", ...unlock, ...bump }).where(where);
  } else if (event.eventType === "account.disconnected") {
    await tx.update(socialConnections).set({ status: "revoked", health: "failing", healthCode: "account_disconnected", healthCheckedAt: sql`now()`, updatedAt: sql`now()`, version: sql`${socialConnections.version} + 1` })
      .where(and(eq(socialConnections.tenantId, job.tenantId), eq(socialConnections.id, event.connectionId), sql`${socialConnections.status} <> 'revoked'`));
  }
  await tx.update(socialWebhookEvents).set({ processedAt: sql`now()` }).where(and(eq(socialWebhookEvents.tenantId, job.tenantId), eq(socialWebhookEvents.id, event.id)));
};
