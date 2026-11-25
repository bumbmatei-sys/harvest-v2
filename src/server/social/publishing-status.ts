import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { socialConnections, socialDrafts, socialPosts } from "../../db/schema";
import { bucketOf, deliveryState, draftState, type DeliveryState } from "../../lib/social/publishing-status";
import { approvalStates, loadSettings } from "./approvals";
import { canRetry } from "./drafts";
import { publishInvalid, recordId, withPublish } from "./publish-access";
import { defaultSocialDeps, type SocialDeps } from "./registry";

// Publishing status per account for the Planner queue. A read model over the existing deliveries: it changes nothing and reveals no post text, token or provider payload.
const queryInput = z.object({ draftId: z.uuid().optional(), bucket: z.enum(["drafts", "scheduled", "sent"]).optional(), limit: z.coerce.number().int().min(1).max(50).default(25) }).strict();
const WINDOW = 200;

export async function readPublishingStatus(db: Database, user: string, workspace: string, rawQuery: Record<string, string | undefined>, deps: SocialDeps = defaultSocialDeps()) {
  const parsed = queryInput.safeParse(rawQuery);
  if (!parsed.success) throw publishInvalid("PUBLISHING_STATUS_INVALID");
  const query = parsed.data;
  return withPublish(db, user, workspace, deps, async (tx, tenant) => {
    const now = deps.now();
    const drafts = await tx.select({ id: socialDrafts.id, status: socialDrafts.status, version: socialDrafts.version, updatedAt: socialDrafts.updatedAt }).from(socialDrafts)
      .where(and(eq(socialDrafts.tenantId, tenant), query.draftId ? eq(socialDrafts.id, recordId(query.draftId)) : ne(socialDrafts.status, "cancelled"),
        query.bucket === "drafts" ? eq(socialDrafts.status, "draft") : query.bucket ? eq(socialDrafts.status, "submitted") : undefined))
      .orderBy(desc(socialDrafts.updatedAt), desc(socialDrafts.id)).limit(query.draftId ? 1 : WINDOW);
    const ids = drafts.map(d => d.id);
    const children = ids.length ? await tx.select({ id: socialPosts.id, draftId: socialPosts.draftId, connectionId: socialPosts.connectionId, status: socialPosts.status, version: socialPosts.version,
      scheduledFor: socialPosts.scheduledFor, publishedAt: socialPosts.publishedAt, firstAttemptAt: socialPosts.firstAttemptAt, attempts: socialPosts.attempts, maxAttempts: socialPosts.maxAttempts,
      lastErrorCode: socialPosts.lastErrorCode, providerPostRef: socialPosts.providerPostRef, providerPostUrl: socialPosts.providerPostUrl, repeatNumber: socialPosts.repeatNumber,
      platform: socialConnections.platform, displayName: socialConnections.displayName }).from(socialPosts)
      .innerJoin(socialConnections, and(eq(socialConnections.tenantId, socialPosts.tenantId), eq(socialConnections.id, socialPosts.connectionId)))
      .where(and(eq(socialPosts.tenantId, tenant), inArray(socialPosts.draftId, ids))).orderBy(socialPosts.id) : [];
    const { required, states } = await approvalStates(tx, tenant, ids);
    const items = drafts.map(draft => {
      const approval = states.get(draft.id) ?? { state: "not_required" as const, approvalId: null };
      const blocked = required && approval.state !== "approved";
      const destinations = children.filter(c => c.draftId === draft.id).map(c => {
        const state: DeliveryState = deliveryState(c, blocked);
        return { postId: c.id, connectionId: c.connectionId, platform: c.platform, displayName: c.displayName, state, errorCode: state === "failed" || state === "partial" || state === "unknown" ? c.lastErrorCode : null,
          url: c.status === "published" ? c.providerPostUrl : null, scheduledFor: c.scheduledFor?.toISOString() ?? null, publishedAt: c.publishedAt?.toISOString() ?? null, attempts: c.attempts, maxAttempts: c.maxAttempts,
          // Retry reuses the original idempotency key; an accepted post is reconciled, never resent; and a post that still needs approval is not retryable until approved.
          retryable: canRetry(c, now) && !blocked, version: c.version };
      });
      const state = draft.status === "draft" ? "draft" as const : draftState(destinations.map(d => d.state));
      return { kind: "draft" as const, id: draft.id, version: draft.version, state, bucket: bucketOf(state), approval: { required, state: approval.state, approvalId: approval.approvalId }, destinations };
    });
    const loose = query.draftId ? [] : await tx.select({ id: socialPosts.id, connectionId: socialPosts.connectionId, status: socialPosts.status, version: socialPosts.version, scheduledFor: socialPosts.scheduledFor,
      publishedAt: socialPosts.publishedAt, lastErrorCode: socialPosts.lastErrorCode, providerPostUrl: socialPosts.providerPostUrl, platform: socialConnections.platform, displayName: socialConnections.displayName,
      fp: sql<string>`encode(sha256(convert_to(${socialPosts.content} || '|' || ${socialPosts.media}::text || '|' || ${socialPosts.connectionId}::text, 'UTF8')), 'hex')` }).from(socialPosts)
      .innerJoin(socialConnections, and(eq(socialConnections.tenantId, socialPosts.tenantId), eq(socialConnections.id, socialPosts.connectionId)))
      .where(and(eq(socialPosts.tenantId, tenant), isNull(socialPosts.draftId), ne(socialPosts.status, "cancelled"))).orderBy(desc(socialPosts.updatedAt)).limit(50);
    const settings = await loadSettings(tx, tenant);
    const approved = settings.mode === "required" && loose.length ? new Set((await tx.execute<{ post_id: string; fingerprint: string }>(sql`select post_id, fingerprint from social_approvals where tenant_id = ${tenant} and status = 'approved' and post_id is not null`)).rows.map(r => `${r.post_id}:${r.fingerprint}`)) : new Set<string>();
    const looseItems = loose.map(p => {
      const blocked = settings.mode === "required" && !approved.has(`${p.id}:${p.fp}`);
      const state = deliveryState(p, blocked);
      return { kind: "post" as const, id: p.id, version: p.version, state, bucket: bucketOf(state), approval: { required: settings.mode === "required", state: settings.mode !== "required" ? "not_required" as const : blocked ? "none" as const : "approved" as const },
        destinations: [{ postId: p.id, connectionId: p.connectionId, platform: p.platform, displayName: p.displayName, state, errorCode: state === "failed" || state === "partial" || state === "unknown" ? p.lastErrorCode : null,
          url: p.status === "published" ? p.providerPostUrl : null, scheduledFor: p.scheduledFor?.toISOString() ?? null, publishedAt: p.publishedAt?.toISOString() ?? null,
          // Draft-less posts are not retried through the Planner; the existing direct-post rules apply.
          attempts: 0, maxAttempts: 0, retryable: false, version: p.version }] };
    });
    const all = [...items, ...looseItems].filter(i => !query.bucket || i.bucket === query.bucket);
    return { items: all.slice(0, query.limit), truncated: all.length > query.limit || drafts.length >= WINDOW, approvalRequired: required };
  });
}
