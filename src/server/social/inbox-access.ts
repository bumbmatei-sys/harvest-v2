import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { auditLogs, socialConnections, socialInboxItems } from "../../db/schema";
import { inboxCapabilities, inboxCapabilityVersion, type InboxKind } from "../../lib/social/platforms";
import { AccessError, type Permission } from "../permissions";
import { withTenant } from "../tenancy";
import { credentialBinding, openCredential } from "./credential-envelope";
import type { InboxReplyMode } from "./inbox-contract";
import { SocialProviderError } from "./port";
import { recordId, unavailable } from "./publish-access";
import { assertEnabled, type SocialDeps } from "./registry";

export type InboxConnection = typeof socialConnections.$inferSelect;
export const referenceInput = z.string().min(1).max(200).refine(value => value.isWellFormed() && !value.includes("\u0000"));
export const inboxText = (max: number) => z.string().trim().min(1).max(max)
  .refine(value => value.isWellFormed() && !value.includes("\u0000"));
export const readCapability = { dm: "conversationRead", comment: "commentRead", mention: "mentions", story: "storyReplies" } as const;
export const replyCapability = { message: "messageReply", comment: "commentReply", private: "privateReply", mention: "mentionReply" } as const;
export const inboxModes: Record<InboxKind, readonly InboxReplyMode[]> = {
  dm: ["message"], story: ["message"], comment: ["comment", "private"], mention: ["mention"],
};

export async function withInbox<T>(db: Database, user: string, workspace: string, deps: SocialDeps,
  run: (tx: Transaction, tenant: string, role: string) => Promise<T>, permission: Permission = "social:inbox") {
  assertEnabled(deps);
  try {
    return await withTenant(db, user, recordId(workspace), permission, run);
  } catch (error) {
    if (error instanceof AccessError && error.status === 403) throw unavailable();
    throw error;
  }
}

export function accountView(row: InboxConnection) {
  const capabilities = inboxCapabilities(row.platform);
  const state = row.status !== "active" ? row.status
    : row.healthCode && /expired|token_revoked|reauth/.test(row.healthCode) ? "expired"
    : row.health === "failing" ? "unhealthy"
    : Object.values(readCapability).some(capability => capabilities[capability] !== "unavailable") ? "available" : "unavailable";
  return { id: row.id, platform: row.platform, displayName: row.displayName, state, health: row.health,
    capabilityVersion: inboxCapabilityVersion, capabilities };
}

export function inboxAccounts(tx: Transaction, tenant: string, ids?: string[]) {
  if (ids && !ids.length) return Promise.resolve([]);
  return tx.select().from(socialConnections).where(and(eq(socialConnections.tenantId, tenant),
    ids ? inArray(socialConnections.id, ids) : undefined)).orderBy(asc(socialConnections.id));
}
export function accountSet(rows: InboxConnection[]) {
  return digest([inboxCapabilityVersion, rows.map(row => [row.id, row.version, row.status, row.health, row.healthCode])]);
}

export async function inboxItem(tx: Transaction, tenant: string, itemId: string, lock = false) {
  const query = tx.select({ item: socialInboxItems, account: socialConnections }).from(socialInboxItems)
    .innerJoin(socialConnections, and(eq(socialInboxItems.tenantId, socialConnections.tenantId), eq(socialInboxItems.connectionId, socialConnections.id)))
    .where(and(eq(socialInboxItems.tenantId, tenant), eq(socialInboxItems.id, recordId(itemId))));
  const [loaded] = await (lock ? query.$dynamic().for("update", { of: socialInboxItems }).for("share", { of: socialConnections }) : query);
  if (!loaded) throw unavailable();
  return loaded;
}

export function providerAccess(row: InboxConnection, deps: SocialDeps) {
  const provider = deps.provider(row.provider);
  if (provider.id !== row.provider) throw new SocialProviderError("UNAVAILABLE");
  const credential = openCredential(row.credentialEnvelope, credentialBinding(row.tenantId, row.id));
  return { provider, credential };
}

export const auditInbox = (tx: Transaction, tenantId: string, actorId: string, action: string, targetId: string, version: number) =>
  tx.insert(auditLogs).values({ tenantId, actorId, action: `social.inbox.${action}`, targetId, metadata: { version: String(version) } });

export function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}
