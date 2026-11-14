import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { auditLogs, socialConnections, socialPosts } from "../../db/schema";
import { message } from "../../i18n/messages";
import { uuidInput } from "../../lib/contact-input";
import { AccessError } from "../permissions";
import { withTenant } from "../tenancy";
import { credentialBinding, openCredential, sealCredential } from "./credential-envelope";
import { SocialProviderError } from "./port";
import { assertEnabled, defaultSocialDeps, type SocialDeps } from "./registry";
import { socialPlatforms, socialProviders } from "./types";

// Server API for the social layer. Every function: integration enabled? -> tenant + permission (withTenant) -> work.
// Provider calls never happen inside a database transaction. Credentials are sealed before they reach a row and never returned.
const stored = z.string().refine((v) => !v.includes("\u0000") && v.isWellFormed(), "INVALID_STORED_STRING");
export const linkInput = z.object({
  provider: z.enum(socialProviders), credential: z.string().min(1).max(500), accountRef: stored.pipe(z.string().min(1).max(200)),
}).strict();
const media = z.object({ kind: z.enum(["image", "video"]), url: z.url({ protocol: /^https$/ }).max(2000) }).strict();
export const postInput = z.object({
  connectionId: z.uuid(), content: stored.pipe(z.string().min(1).max(10_000)), media: z.array(media).max(10).default([]), scheduledFor: z.iso.datetime({ offset: true }).nullable().default(null),
}).strict();
const scheduleInput = z.object({ scheduledFor: z.iso.datetime({ offset: true }).nullable() }).strict();
const SCHEDULE_SKEW_MS = 60_000, SCHEDULE_HORIZON_MS = 366 * 86_400_000;

const unavailable = () => new AccessError(404, message("Errors.workspaceUnavailable"));
const invalid = () => new AccessError(400, message("Errors.checkTheSuppliedDetails"));
const stale = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
const hasCode = (error: unknown, code: string): boolean => !!error && typeof error === "object" && (("code" in error && error.code === code) || ("cause" in error && hasCode(error.cause, code)));
/** Provider failures become a plain access error; the provider's own message never leaves. */
const providerFailure = (error: unknown) => {
  if (error instanceof SocialProviderError) return error.code === "RATE_LIMITED" ? new AccessError(429, message("Errors.somethingWentWrongPleaseTryAgain")) : invalid();
  return error;
};
const audit = (tx: Parameters<Parameters<typeof withTenant>[4]>[0], tenantId: string, actorId: string, action: string, targetId: string, metadata: Record<string, string> = {}) =>
  tx.insert(auditLogs).values({ tenantId, actorId, action, targetId, metadata });

const publicConnection = (row: typeof socialConnections.$inferSelect) => ({
  id: row.id, provider: row.provider, platform: row.platform, externalAccountRef: row.externalAccountRef, displayName: row.displayName,
  status: row.status, health: row.health, healthCode: row.healthCode, healthCheckedAt: row.healthCheckedAt, version: row.version, createdAt: row.createdAt,
});
const publicPost = (row: typeof socialPosts.$inferSelect) => ({
  id: row.id, connectionId: row.connectionId, status: row.status, content: row.content, media: row.media, scheduledFor: row.scheduledFor, attempts: row.attempts,
  maxAttempts: row.maxAttempts, providerPostRef: row.providerPostRef, publishedAt: row.publishedAt, lastErrorCode: row.lastErrorCode, version: row.version, createdAt: row.createdAt,
});

export async function listConnections(db: Database, userId: string, workspace: string, deps: SocialDeps = defaultSocialDeps()) {
  assertEnabled(deps);
  return withTenant(db, userId, uuidInput.parse(workspace), "social:connect", async (tx, tenantId) => {
    const rows = await tx.select().from(socialConnections).where(eq(socialConnections.tenantId, tenantId)).orderBy(asc(socialConnections.createdAt), asc(socialConnections.id));
    return { connections: rows.map(publicConnection) };
  });
}

/**
 * Links one provider account. The account reference must be one the provider returns under the supplied credential:
 * a reference is never taken on trust. The credential is sealed (bound to this tenant and connection) before it is stored.
 */
export async function linkConnection(db: Database, userId: string, workspace: string, data: unknown, deps: SocialDeps = defaultSocialDeps()) {
  assertEnabled(deps);
  const input = linkInput.parse(data);
  // Authorize first, then call the provider with no transaction open.
  const tenantId = await withTenant(db, userId, uuidInput.parse(workspace), "social:connect", async (_tx, id) => id);
  let account;
  try { account = (await deps.provider(input.provider).listAccounts({ secret: input.credential })).find((a) => a.accountRef === input.accountRef); }
  catch (error) { throw providerFailure(error); }
  if (!account || !(socialPlatforms as readonly string[]).includes(account.platform)) throw invalid();
  const id = randomUUID(), envelope = sealCredential({ secret: input.credential }, credentialBinding(tenantId, id));
  try {
    return await withTenant(db, userId, tenantId, "social:connect", async (tx) => {
      const [row] = await tx.insert(socialConnections).values({ tenantId, id, provider: input.provider, platform: account.platform, externalAccountRef: account.accountRef,
        displayName: account.displayName, credentialEnvelope: envelope as unknown as Record<string, unknown>, createdBy: userId }).returning();
      await audit(tx, tenantId, userId, "social.connection_link", id, { provider: input.provider, platform: account.platform });
      return { connection: publicConnection(row) };
    });
  } catch (error) {
    // The account is already linked to a live connection (in this or another ministry): the same answer either way.
    if (hasCode(error, "23505")) throw stale();
    throw error;
  }
}

export async function setConnectionEnabled(db: Database, userId: string, workspace: string, connectionId: string, enabled: boolean, deps: SocialDeps = defaultSocialDeps()) {
  assertEnabled(deps);
  const id = uuidInput.parse(connectionId);
  return withTenant(db, userId, uuidInput.parse(workspace), "social:connect", async (tx, tenantId) => {
    const [row] = await tx.update(socialConnections).set({ status: enabled ? "active" : "disabled", updatedAt: sql`now()`, version: sql`${socialConnections.version} + 1` })
      .where(and(eq(socialConnections.tenantId, tenantId), eq(socialConnections.id, id), inArray(socialConnections.status, ["active", "disabled"]))).returning();
    if (!row) throw unavailable();
    await audit(tx, tenantId, userId, enabled ? "social.connection_enable" : "social.connection_disable", id, { status: row.status });
    return { connection: publicConnection(row) };
  });
}

/** Asks the provider how the account is doing and records the answer (fixed health value and code only). */
export async function refreshConnectionHealth(db: Database, userId: string, workspace: string, connectionId: string, deps: SocialDeps = defaultSocialDeps()) {
  assertEnabled(deps);
  const id = uuidInput.parse(connectionId);
  const loaded = await withTenant(db, userId, uuidInput.parse(workspace), "social:connect", async (tx, tenantId) => {
    const [row] = await tx.select().from(socialConnections).where(and(eq(socialConnections.tenantId, tenantId), eq(socialConnections.id, id), eq(socialConnections.status, "active")));
    return row ? { tenantId, row } : null;
  });
  if (!loaded) throw unavailable();
  let health;
  try {
    const credential = openCredential(loaded.row.credentialEnvelope, credentialBinding(loaded.tenantId, id));
    health = await deps.provider(loaded.row.provider).getAccountHealth(credential, loaded.row.externalAccountRef);
  } catch (error) { throw providerFailure(error instanceof SocialProviderError ? error : new SocialProviderError("UNAVAILABLE")); }
  return withTenant(db, userId, loaded.tenantId, "social:connect", async (tx, tenantId) => {
    const [row] = await tx.update(socialConnections).set({ health: health.health, healthCode: health.code, healthCheckedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(socialConnections.tenantId, tenantId), eq(socialConnections.id, id), eq(socialConnections.status, "active"))).returning();
    if (!row) throw unavailable();
    await audit(tx, tenantId, userId, "social.connection_health", id, { health: health.health });
    return { connection: publicConnection(row) };
  });
}

function scheduleTime(value: string | null, deps: SocialDeps) {
  if (value === null) return null;
  const at = new Date(value), now = deps.now().getTime();
  if (at.getTime() < now - SCHEDULE_SKEW_MS || at.getTime() > now + SCHEDULE_HORIZON_MS) throw invalid();
  return at;
}
/** Creates a draft (no time) or a scheduled post. Nothing is sent: the worker publishes it when it is due. */
export async function schedulePost(db: Database, userId: string, workspace: string, data: unknown, deps: SocialDeps = defaultSocialDeps()) {
  assertEnabled(deps);
  const input = postInput.parse(data), at = scheduleTime(input.scheduledFor, deps);
  return withTenant(db, userId, uuidInput.parse(workspace), "social:schedule", async (tx, tenantId) => {
    const [connection] = await tx.select({ id: socialConnections.id }).from(socialConnections)
      .where(and(eq(socialConnections.tenantId, tenantId), eq(socialConnections.id, input.connectionId), eq(socialConnections.status, "active")));
    if (!connection) throw unavailable();
    const [row] = await tx.insert(socialPosts).values({ tenantId, connectionId: input.connectionId, status: at ? "scheduled" : "draft", content: input.content, media: input.media,
      scheduledFor: at, nextAttemptAt: at, idempotencyKey: randomUUID(), createdBy: userId }).returning();
    await audit(tx, tenantId, userId, "social.post_create", row.id, { status: row.status });
    return { post: publicPost(row) };
  });
}
/** Sets or clears the time of a draft or scheduled post. `null` returns it to draft. */
export async function reschedulePost(db: Database, userId: string, workspace: string, postId: string, data: unknown, deps: SocialDeps = defaultSocialDeps()) {
  assertEnabled(deps);
  const id = uuidInput.parse(postId), input = scheduleInput.parse(data), at = scheduleTime(input.scheduledFor, deps);
  return withTenant(db, userId, uuidInput.parse(workspace), "social:schedule", async (tx, tenantId) => {
    const [row] = await tx.update(socialPosts).set({ status: at ? "scheduled" : "draft", scheduledFor: at, nextAttemptAt: at, updatedAt: sql`now()`, version: sql`${socialPosts.version} + 1` })
      .where(and(eq(socialPosts.tenantId, tenantId), eq(socialPosts.id, id), inArray(socialPosts.status, ["draft", "scheduled"]))).returning();
    if (!row) throw await missingOrStale(tx, tenantId, id);
    await audit(tx, tenantId, userId, "social.post_schedule", id, { status: row.status });
    return { post: publicPost(row) };
  });
}
export async function cancelPost(db: Database, userId: string, workspace: string, postId: string, deps: SocialDeps = defaultSocialDeps()) {
  assertEnabled(deps);
  const id = uuidInput.parse(postId);
  return withTenant(db, userId, uuidInput.parse(workspace), "social:schedule", async (tx, tenantId) => {
    const [row] = await tx.update(socialPosts).set({ status: "cancelled", updatedAt: sql`now()`, version: sql`${socialPosts.version} + 1` })
      .where(and(eq(socialPosts.tenantId, tenantId), eq(socialPosts.id, id), inArray(socialPosts.status, ["draft", "scheduled", "failed"]))).returning();
    if (!row) throw await missingOrStale(tx, tenantId, id);
    await audit(tx, tenantId, userId, "social.post_cancel", id, { status: "cancelled" });
    return { post: publicPost(row) };
  });
}
/** Puts a failed post back in the queue. The database refuses it when an earlier attempt may have gone out unseen. */
export async function retryPost(db: Database, userId: string, workspace: string, postId: string, deps: SocialDeps = defaultSocialDeps()) {
  assertEnabled(deps);
  const id = uuidInput.parse(postId);
  return withTenant(db, userId, uuidInput.parse(workspace), "social:schedule", async (tx, tenantId) => {
    try {
      const [row] = await tx.transaction((inner) => inner.update(socialPosts).set({ status: "scheduled", attempts: 0, nextAttemptAt: sql`now()`, scheduledFor: sql`greatest(${socialPosts.scheduledFor}, now())`,
        updatedAt: sql`now()`, version: sql`${socialPosts.version} + 1` })
        .where(and(eq(socialPosts.tenantId, tenantId), eq(socialPosts.id, id), eq(socialPosts.status, "failed"), sql`${socialPosts.providerPostRef} is null`)).returning());
      if (!row) throw await missingOrStale(tx, tenantId, id);
      await audit(tx, tenantId, userId, "social.post_retry", id, { status: "scheduled" });
      return { post: publicPost(row) };
    } catch (error) {
      if (error instanceof AccessError) throw error;
      // The guard trigger raised: an ambiguous or out-of-window failure.
      if (hasCode(error, "P0001")) throw stale();
      throw error;
    }
  });
}
async function missingOrStale(tx: Parameters<Parameters<typeof withTenant>[4]>[0], tenantId: string, id: string) {
  const [row] = await tx.select({ id: socialPosts.id }).from(socialPosts).where(and(eq(socialPosts.tenantId, tenantId), eq(socialPosts.id, id)));
  return row ? stale() : unavailable();
}
export async function listPosts(db: Database, userId: string, workspace: string, query: { status?: string; page?: number } = {}, deps: SocialDeps = defaultSocialDeps()) {
  assertEnabled(deps);
  const status = z.enum(["draft", "scheduled", "publishing", "published", "failed", "cancelled"]).optional().parse(query.status), page = z.number().int().min(1).max(10_000).default(1).parse(query.page);
  return withTenant(db, userId, uuidInput.parse(workspace), "social:schedule", async (tx, tenantId) => {
    const rows = await tx.select().from(socialPosts).where(and(eq(socialPosts.tenantId, tenantId), status ? eq(socialPosts.status, status) : undefined))
      .orderBy(desc(socialPosts.createdAt), desc(socialPosts.id)).limit(51).offset((page - 1) * 50);
    return { posts: rows.slice(0, 50).map(publicPost), page, hasMore: rows.length > 50 };
  });
}
export async function getPost(db: Database, userId: string, workspace: string, postId: string, deps: SocialDeps = defaultSocialDeps()) {
  assertEnabled(deps);
  const id = uuidInput.parse(postId);
  return withTenant(db, userId, uuidInput.parse(workspace), "social:schedule", async (tx, tenantId) => {
    const [row] = await tx.select().from(socialPosts).where(and(eq(socialPosts.tenantId, tenantId), eq(socialPosts.id, id)));
    if (!row) throw unavailable();
    return { post: publicPost(row) };
  });
}
