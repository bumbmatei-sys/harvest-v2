import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, communities, communityMemberships, entitlements, reservedCommunitySlugs } from "../db/schema";
import { communityStaffRoles, type CommunityRole } from "../lib/community-permissions";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant, withUser } from "./tenancy";

// ADR 0013 (C02/C03). Owner-side services run in withTenant (staff RLS path); member access runs in
// withUser (member RLS path). Paid pricing is refused until the Commerce gate (C17).
export const communitySlug = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/)
  .refine((slug) => !(reservedCommunitySlugs as readonly string[]).includes(slug));
const name = z.string().trim().min(1).max(80);
const tagline = z.string().trim().min(1).max(160);

const createInput = z.object({ name, slug: communitySlug, tagline: tagline.optional() }).strict();
const updateInput = z.object({
  version: z.number().int().min(1),
  name: name.optional(), tagline: tagline.nullable().optional(),
  visibility: z.enum(["listed", "unlisted", "hidden"]).optional(),
  pricing: z.enum(["free", "paid"]).optional(),
  allowOpen: z.boolean().optional(), allowApply: z.boolean().optional(),
  allowInvite: z.boolean().optional(), allowEntitlement: z.boolean().optional(),
}).strict();
const grantInput = z.object({ userId: z.string().min(1).max(200), validUntil: z.iso.datetime().optional(), reason: z.string().trim().min(1).max(200).optional() }).strict();
const revokeInput = z.object({ reason: z.string().trim().min(1).max(200).optional() }).strict();

const uniqueViolation = (error: unknown) => (error as { cause?: { code?: string } })?.cause?.code === "23505" || (error as { code?: string })?.code === "23505";

async function ownCommunity(tx: Transaction, tenantId: string, communityId: string) {
  const [row] = await tx.select().from(communities).where(and(eq(communities.tenantId, tenantId), eq(communities.id, communityId)));
  if (!row) throw new AccessError(404, message("Errors.communityNotFound"));
  return row;
}

export async function createCommunity(db: Database, userId: string, workspace: string, raw: unknown) {
  const input = createInput.parse(raw);
  try {
    return await withTenant(db, userId, z.uuid().parse(workspace), "communities:manage", async (tx, tenantId) => {
      const [row] = await tx.insert(communities).values({ tenantId, slug: input.slug, name: input.name, tagline: input.tagline ?? null, createdBy: userId }).returning();
      await tx.insert(communityMemberships).values({ tenantId, communityId: row.id, userId, role: "owner", status: "active", joinedAt: new Date() });
      await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "community.create", targetId: row.id });
      return row;
    });
  } catch (error) {
    if (uniqueViolation(error)) throw new AccessError(409, message("Errors.communitySlugTaken"));
    throw error;
  }
}

export function listCommunities(db: Database, userId: string, workspace: string) {
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:read", (tx, tenantId) =>
    tx.select().from(communities).where(eq(communities.tenantId, tenantId)).orderBy(communities.createdAt));
}

export async function updateCommunity(db: Database, userId: string, workspace: string, communityId: string, raw: unknown) {
  const { version, ...changes } = updateInput.parse(raw);
  if (changes.pricing === "paid") throw new AccessError(409, message("Errors.paidCommunitiesUnavailable"));
  const id = z.uuid().parse(communityId);
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:manage", async (tx, tenantId) => {
    await ownCommunity(tx, tenantId, id);
    const [row] = await tx.update(communities).set({ ...changes, version: version + 1, updatedAt: new Date() })
      .where(and(eq(communities.tenantId, tenantId), eq(communities.id, id), eq(communities.version, version))).returning();
    if (!row) throw new AccessError(409, message("Errors.communityChanged"));
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "community.update", targetId: id, metadata: { fields: Object.keys(changes).sort().join(",") } });
    return row;
  });
}

/** Grants a person access to a community (admin grant) and activates their membership. Banned members stay banned. */
export async function grantCommunityAccess(db: Database, userId: string, workspace: string, communityId: string, raw: unknown) {
  const input = grantInput.parse(raw);
  const id = z.uuid().parse(communityId);
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:manage", async (tx, tenantId) => {
    await ownCommunity(tx, tenantId, id);
    const where = and(eq(communityMemberships.tenantId, tenantId), eq(communityMemberships.communityId, id), eq(communityMemberships.userId, input.userId));
    const [membership] = await tx.select().from(communityMemberships).where(where).for("update");
    if (membership?.status === "banned") throw new AccessError(409, message("Errors.communityMemberBanned"));
    const now = new Date();
    if (!membership) await tx.insert(communityMemberships).values({ tenantId, communityId: id, userId: input.userId, role: "member", status: "active", joinedAt: now });
    else if (membership.status !== "active") await tx.update(communityMemberships).set({ status: "active", joinedAt: now, updatedAt: now }).where(where);
    const [grant] = await tx.insert(entitlements).values({ tenantId, userId: input.userId, resourceType: "community", resourceId: id, source: "admin_grant",
      grantedBy: userId, validUntil: input.validUntil ? new Date(input.validUntil) : null, reason: input.reason ?? null }).returning();
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "community.access_grant", targetId: id, metadata: { source: "admin_grant", entitlementId: grant.id } });
    return grant;
  });
}

export async function revokeEntitlement(db: Database, userId: string, workspace: string, entitlementId: string, raw: unknown) {
  revokeInput.parse(raw);
  const id = z.uuid().parse(entitlementId);
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:manage", async (tx, tenantId) => {
    const now = new Date();
    const [row] = await tx.update(entitlements).set({ revokedAt: now, revokedBy: userId })
      .where(and(eq(entitlements.tenantId, tenantId), eq(entitlements.id, id), isNull(entitlements.revokedAt))).returning();
    if (!row) throw new AccessError(404, message("Errors.entitlementNotFound"));
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "community.access_revoke", targetId: row.resourceId, metadata: { entitlementId: id } });
    return row;
  });
}

export type CommunityAccess = { allowed: boolean; role: CommunityRole | null; sources: string[] };

/**
 * Effective access for the signed-in person (member RLS path): an ACTIVE membership, plus either a staff
 * community role or at least one valid, unrevoked grant. The union of grants decides; ending one keeps the rest.
 */
export function communityAccess(db: Database, viewerId: string, communityId: string): Promise<CommunityAccess> {
  const id = z.uuid().parse(communityId);
  return withUser(db, viewerId, async (tx) => {
    const [membership] = await tx.select().from(communityMemberships).where(and(eq(communityMemberships.communityId, id), eq(communityMemberships.userId, viewerId)));
    if (!membership || membership.status !== "active") return { allowed: false, role: null, sources: [] };
    const now = new Date();
    const grants = await tx.select({ source: entitlements.source }).from(entitlements).where(and(
      eq(entitlements.userId, viewerId), eq(entitlements.resourceType, "community"), eq(entitlements.resourceId, id),
      isNull(entitlements.revokedAt), lte(entitlements.validFrom, now), or(isNull(entitlements.validUntil), gt(entitlements.validUntil, now))));
    const role = membership.role as CommunityRole, sources = grants.map((g) => g.source).sort();
    return { allowed: communityStaffRoles.includes(role) || sources.length > 0, role, sources };
  });
}
