import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { socialDrafts, socialPosts } from "../../db/schema";
import { composerInput, type ComposerInput } from "../../lib/social/composer";
import { inspectComposer } from "./compose-validation";
import { allocateSlots, targetInput, timezoneInput } from "./posting-schedules";
import { auditPublish, publishConflict, publishInvalid, recordId, unavailable, versionInput, withPublish } from "./publish-access";
import { defaultSocialDeps } from "./registry";

const reviewTtlMs = 10 * 60_000;
type Draft = typeof socialDrafts.$inferSelect;
const deliveryColumns = {
  id: socialPosts.id, draftId: socialPosts.draftId, connectionId: socialPosts.connectionId, scheduleId: socialPosts.scheduleId,
  status: socialPosts.status, displayTimezone: socialPosts.displayTimezone, version: socialPosts.version,
  scheduledFor: socialPosts.scheduledFor, publishedAt: socialPosts.publishedAt, firstAttemptAt: socialPosts.firstAttemptAt,
  attempts: socialPosts.attempts, lastErrorCode: socialPosts.lastErrorCode, repeatNumber: socialPosts.repeatNumber,
  providerPostRef: socialPosts.providerPostRef,
};
type Post = Pick<typeof socialPosts.$inferSelect, keyof typeof deliveryColumns>;
type Previews = Awaited<ReturnType<typeof inspectComposer>>["previews"];
const draftKey = (tenant: string, id: string) => and(eq(socialDrafts.tenantId, tenant), eq(socialDrafts.id, id));
const childKey = (tenant: string, id: string) => and(eq(socialPosts.tenantId, tenant), eq(socialPosts.draftId, id));
const clearReview = { reviewBy: null, reviewExpires: null, reviewHash: null };
const version = (current: Draft) => ({ version: current.version + 1, updatedAt: sql`now()` });

const retryable = ["PROVIDER_RATE_LIMITED", "CONNECTION_UNAVAILABLE", "CREDENTIAL_UNAVAILABLE", "MEDIA_UNAVAILABLE", "MEDIA_URL_EXPIRED", "PROVIDER_AUTH"];
export function canRetry(post: Pick<Post, "status" | "providerPostRef" | "firstAttemptAt" | "lastErrorCode">, now: Date) {
  return post.status === "failed" && !post.providerPostRef && retryable.includes(post.lastErrorCode ?? "") &&
    (!post.firstAttemptAt || now.getTime() - post.firstAttemptAt.getTime() < 23 * 3_600_000);
}
export const presentDelivery = (post: Post, now: Date) => ({
  id: post.id, draftId: post.draftId, connectionId: post.connectionId, scheduleId: post.scheduleId, status: post.status,
  displayTimezone: post.displayTimezone, version: post.version, scheduledFor: post.scheduledFor, publishedAt: post.publishedAt,
  firstAttemptAt: post.firstAttemptAt, attempts: post.attempts, lastErrorCode: post.lastErrorCode, repeatNumber: post.repeatNumber,
  retryable: canRetry(post, now),
});
const present = (draft: Draft, children: Post[], now: Date) => ({
  id: draft.id, document: draft.document, status: draft.status, version: draft.version, createdAt: draft.createdAt, updatedAt: draft.updatedAt,
  destinations: children.map(post => presentDelivery(post, now)),
});
async function get(tx: Transaction, tenant: string, id: string, lock = false) {
  const query = tx.select().from(socialDrafts).where(draftKey(tenant, recordId(id)));
  const [draft] = await (lock ? query.for("update") : query);
  if (!draft) throw unavailable();
  const childQuery = tx.select(deliveryColumns).from(socialPosts).where(childKey(tenant, draft.id)).orderBy(socialPosts.id);
  return { draft, children: await (lock ? childQuery.for("update") : childQuery) };
}
async function create(tx: Transaction, tenantId: string, user: string, document: ComposerInput) {
  const [draft] = await tx.insert(socialDrafts).values({ tenantId, createdBy: user, document }).returning();
  return draft;
}
function requireReady(previews: Previews) {
  if (!previews.length) throw publishInvalid("DESTINATION_REQUIRED");
  const destinations = previews.filter(preview => preview.errors.length).map(({ account, errors }) => ({ connectionId: account.id, errors }));
  if (destinations.length) throw publishInvalid(destinations[0].errors[0], { destinations });
}
function requireDraftMedia(previews: Previews) {
  const destinations = previews.map(preview => ({ connectionId: preview.account.id, errors: preview.errors.filter(error =>
    error !== "MEDIA_REQUIRED" && (error.startsWith("MEDIA_") || error.includes("SUBTITLE") || error.startsWith("ALT_TEXT_") || error === "UNSUPPORTED_POST_TYPE" || error === "ACCOUNT_UNAVAILABLE")) }))
    .filter(destination => destination.errors.length);
  if (destinations.length) throw publishInvalid(destinations[0].errors[0], { destinations });
}
function hashReview(token: string, draft: Draft, user: string, previews: Previews) {
  return createHash("sha256").update(JSON.stringify([token, draft.tenantId, draft.id, draft.version, user, draft.document,
    previews.map(preview => [preview.account.id, preview.account.version])])).digest("hex");
}

export function previewDraft(db: Database, user: string, workspace: string, raw: unknown, deps = defaultSocialDeps()) {
  return withPublish(db, user, workspace, deps, async (tx, tenant) => {
    const { previews, missingMedia } = await inspectComposer(tx, tenant, composerInput.parse(raw), true);
    return { destinations: previews, missingMedia };
  });
}
export function readDraft(db: Database, user: string, workspace: string, id: string, deps = defaultSocialDeps()) {
  return withPublish(db, user, workspace, deps, async (tx, tenant) => {
    const { draft, children } = await get(tx, tenant, id);
    return { draft: present(draft, children, deps.now()) };
  });
}
export function saveDraft(db: Database, user: string, workspace: string, raw: unknown, deps = defaultSocialDeps()) {
  return withPublish(db, user, workspace, deps, async (tx, tenant) => {
    const document = composerInput.parse(raw);
    const { previews } = await inspectComposer(tx, tenant, document);
    requireDraftMedia(previews);
    const draft = await create(tx, tenant, user, document);
    await auditPublish(tx, tenant, user, "social.draft_create", draft.id);
    return { draft: present(draft, [], deps.now()), destinations: previews };
  });
}

const actionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), version: versionInput, document: composerInput }).strict(),
  z.object({ action: z.literal("duplicate"), version: versionInput }).strict(),
  z.object({ action: z.literal("editAfterAttempt"), version: versionInput, document: composerInput.optional() }).strict(),
  z.object({ action: z.literal("review"), version: versionInput }).strict(),
  z.object({ action: z.literal("publishNow"), version: versionInput, reviewToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), timezone: timezoneInput }).strict(),
  z.object({ action: z.literal("schedule"), version: versionInput, target: targetInput }).strict(),
  z.object({ action: z.literal("move"), version: versionInput, target: targetInput }).strict(),
  z.object({ action: z.literal("moveDelivery"), version: versionInput, deliveryId: z.uuid(), deliveryVersion: versionInput, target: targetInput }).strict(),
  z.object({ action: z.literal("cancel"), version: versionInput }).strict(),
  z.object({ action: z.literal("retry"), version: versionInput, deliveries: z.array(z.object({ id: z.uuid(), version: versionInput }).strict()).min(1).max(50)
    .refine(items => new Set(items.map(item => item.id)).size === items.length) }).strict(),
]);

export function changeDraft(db: Database, user: string, workspace: string, id: string, raw: unknown, deps = defaultSocialDeps()) {
  return withPublish(db, user, workspace, deps, async (tx, tenant) => {
    const input = actionInput.parse(raw);
    const { draft, children } = await get(tx, tenant, id, true);
    if (input.version !== draft.version) throw publishConflict();
    const now = deps.now();
    if (input.action === "duplicate" || input.action === "editAfterAttempt") {
      if (input.action === "editAfterAttempt" && !children.some(child => child.firstAttemptAt)) throw publishConflict("NO_ATTEMPT");
      const document = input.action === "duplicate" ? draft.document : input.document ?? {
        ...draft.document,
        connectionIds: draft.document.connectionIds.filter(connectionId =>
          !children.some(child => child.connectionId === connectionId && (child.status === "published" || child.status === "publishing" || child.status === "unknown"))),
      };
      const { previews } = await inspectComposer(tx, tenant, document);
      requireDraftMedia(previews);
      const copy = await create(tx, tenant, user, document);
      await auditPublish(tx, tenant, user, input.action === "duplicate" ? "social.draft_duplicate" : "social.draft_edit_after_attempt", copy.id);
      return { draft: present(copy, [], now), destinations: previews };
    }
    if (draft.status === "cancelled") throw publishConflict("DRAFT_CANCELLED");
    if (input.action === "cancel") {
      await tx.update(socialPosts).set({ status: "cancelled", version: sql`${socialPosts.version} + 1`, updatedAt: sql`now()` })
        .where(and(childKey(tenant, id), inArray(socialPosts.status, ["scheduled", "failed"]), isNull(socialPosts.providerPostRef))).returning({ id: socialPosts.id });
      await tx.update(socialDrafts).set({ status: "cancelled", ...clearReview, ...version(draft) }).where(draftKey(tenant, id));
    } else if (input.action === "retry") {
      if (draft.status !== "submitted") throw publishConflict("DRAFT_NOT_SUBMITTED");
      const { previews } = await inspectComposer(tx, tenant, draft.document, true);
      for (const selected of input.deliveries) {
        const post = children.find(child => child.id === selected.id);
        if (!post) throw unavailable();
        if (selected.version !== post.version) throw publishConflict();
        if (!canRetry(post, now)) throw publishConflict("DELIVERY_NOT_RETRYABLE");
        const preview = previews.find(candidate => candidate.account.id === post.connectionId);
        if (!preview) throw unavailable();
        requireReady([preview]);
        await tx.update(socialPosts).set({ status: "scheduled", attempts: 0, nextAttemptAt: now,
          version: post.version + 1, updatedAt: sql`now()` }).where(and(eq(socialPosts.tenantId, tenant), eq(socialPosts.id, post.id)));
      }
      await tx.update(socialDrafts).set(version(draft)).where(draftKey(tenant, id));
    } else if (input.action === "save") {
      if (draft.status !== "draft") throw publishConflict("DRAFT_ALREADY_SUBMITTED");
      const { previews } = await inspectComposer(tx, tenant, input.document);
      requireDraftMedia(previews);
      const [saved] = await tx.update(socialDrafts).set({ document: input.document, ...clearReview, ...version(draft) }).where(draftKey(tenant, id)).returning();
      await auditPublish(tx, tenant, user, "social.draft_save", id);
      return { draft: present(saved, [], now), destinations: previews };
    } else if (input.action === "moveDelivery") {
      const post = children.find(child => child.id === input.deliveryId);
      if (!post) throw unavailable();
      if (post.version !== input.deliveryVersion) throw publishConflict();
      if (draft.status !== "submitted" || post.status !== "scheduled" || post.firstAttemptAt) throw publishConflict("DELIVERY_ALREADY_ATTEMPTED");
      const { previews } = await inspectComposer(tx, tenant, draft.document, true);
      const preview = previews.find(destination => destination.account.id === post.connectionId);
      if (!preview) throw unavailable();
      requireReady([preview]);
      const platform = preview.account.platform;
      const { at, timezone, scheduleId } = (await allocateSlots(tx, tenant, [platform], input.target, deps, id)).get(platform)!;
      await tx.update(socialPosts).set({ scheduledFor: at, nextAttemptAt: at, scheduleId, displayTimezone: timezone,
        version: post.version + 1, updatedAt: sql`now()` }).where(and(eq(socialPosts.tenantId, tenant), eq(socialPosts.id, post.id)));
      await tx.update(socialDrafts).set(version(draft)).where(draftKey(tenant, id));
    } else {
      if (input.action === "move") {
        if (draft.status !== "submitted" || !children.length ||
          children.some(child => child.status !== "scheduled" || child.firstAttemptAt)) throw publishConflict("DELIVERY_ALREADY_ATTEMPTED");
      } else if (draft.status !== "draft") {
        throw publishConflict("DRAFT_ALREADY_SUBMITTED");
      }
      const { previews } = await inspectComposer(tx, tenant, draft.document);
      requireReady(previews);
      if (input.action === "review") {
        const reviewToken = randomBytes(32).toString("base64url");
        const expiresAt = new Date(now.getTime() + reviewTtlMs);
        const reviewHash = hashReview(reviewToken, { ...draft, version: draft.version + 1 }, user, previews);
        const [reviewed] = await tx.update(socialDrafts).set({ reviewHash, reviewBy: user, reviewExpires: expiresAt, ...version(draft) })
          .where(draftKey(tenant, id)).returning();
        await auditPublish(tx, tenant, user, "social.draft_review", id);
        return { draft: present(reviewed, [], now), review: { token: reviewToken, expiresAt, destinations: previews } };
      }
      if (input.action === "publishNow") {
        const valid = draft.reviewHash && draft.reviewBy === user && draft.reviewExpires && draft.reviewExpires > now &&
          timingSafeEqual(Buffer.from(draft.reviewHash, "hex"), Buffer.from(hashReview(input.reviewToken, draft, user, previews), "hex"));
        if (!valid) throw publishConflict("REVIEW_REQUIRED");
      }
      const platforms = [...new Set(previews.map(preview => preview.account.platform))];
      const slots = input.action === "publishNow" ? new Map(platforms.map(platform => [platform, { at: now, timezone: input.timezone, scheduleId: null }])) :
        await allocateSlots(tx, tenant, platforms, input.target, deps, id);
      for (const preview of previews) {
        const { at, timezone, scheduleId } = slots.get(preview.account.platform)!;
        const time = { scheduledFor: at, nextAttemptAt: at, displayTimezone: timezone, scheduleId };
        if (input.action === "move") {
          await tx.update(socialPosts).set({ ...time, version: sql`${socialPosts.version} + 1`, updatedAt: sql`now()` })
            .where(and(childKey(tenant, id), eq(socialPosts.connectionId, preview.account.id)));
        } else {
          await tx.insert(socialPosts).values({ ...time, status: "scheduled", tenantId: tenant, draftId: id, connectionId: preview.account.id,
            createdBy: user, idempotencyKey: randomUUID(), content: preview.content, delivery: { type: draft.document.type, media: preview.attachments, options: preview.options } });
        }
      }
      await tx.update(socialDrafts).set({ status: "submitted", ...clearReview, ...version(draft) }).where(draftKey(tenant, id));
    }
    await auditPublish(tx, tenant, user, `social.draft_${input.action}`, id);
    const updated = await get(tx, tenant, id);
    return { draft: present(updated.draft, updated.children, now) };
  });
}
