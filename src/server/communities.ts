import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, communities, communityInvites, communityMemberships, discoverListings, entitlements, reservedCommunitySlugs, users, workspaces } from "../db/schema";
import { discoverEligible, emailHash, emailHint, hashSecret, listingFor, newInviteToken } from "../lib/community-listing";
import { communityStaffRoles, type CommunityRole } from "../lib/community-permissions";
import { readyToPublish } from "../lib/community-editor";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant, withUser } from "./tenancy";

// ADR 0013 (C02/C03). Owner-side services run in withTenant (staff RLS path); member access runs in
// withUser (member RLS path). Paid pricing is refused until the Commerce gate (C17).
export const communitySlug = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/)
  .refine((slug) => !(reservedCommunitySlugs as readonly string[]).includes(slug));
const name = z.string().trim().min(1).max(80);
const tagline = z.string().trim().min(1).max(160);
const description = z.string().trim().min(1).max(2000);
const rules = z.string().trim().min(1).max(5000);
/** Per-ministry cap on communities (ADR 0013 §4a), so one ministry cannot reserve addresses without limit. */
export const communityLimit = 50;

const createInput = z.object({ name, slug: communitySlug, tagline: tagline.optional() }).strict();
const updateInput = z.object({
  version: z.number().int().min(1),
  name: name.optional(), tagline: tagline.nullable().optional(),
  visibility: z.enum(["listed", "unlisted", "hidden"]).optional(),
  pricing: z.enum(["free", "paid"]).optional(),
  allowOpen: z.boolean().optional(), allowApply: z.boolean().optional(),
  allowInvite: z.boolean().optional(), allowEntitlement: z.boolean().optional(),
  description: description.nullable().optional(), rules: rules.nullable().optional(), discoverOptIn: z.boolean().optional(),
}).strict();
const grantInput = z.object({ userId: z.string().min(1).max(200), validUntil: z.iso.datetime().optional(), reason: z.string().trim().min(1).max(200).optional() }).strict();
const revokeInput = z.object({}).strict();

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
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(communities).where(eq(communities.tenantId, tenantId));
      if (n >= communityLimit) throw new AccessError(409, message("Errors.communityDraftLimit"));
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
    const current = await ownCommunity(tx, tenantId, id);
    // A published community must keep meeting the publish checklist (review finding on #58).
    if (current.status === "published" && !readyToPublish({ ...current, ...changes })) throw new AccessError(409, message("Errors.communityNotReady"));
    // A rules change bumps the rules version, so earlier acceptances (and open join dialogs) no longer count.
    const rulesChanged = changes.rules !== undefined && changes.rules !== current.rules;
    const [row] = await tx.update(communities).set({ ...changes, ...(rulesChanged ? { rulesVersion: current.rulesVersion + 1 } : {}), version: version + 1, updatedAt: new Date() })
      .where(and(eq(communities.tenantId, tenantId), eq(communities.id, id), eq(communities.version, version))).returning();
    if (!row) throw new AccessError(409, message("Errors.communityChanged"));
    await syncListing(tx, tenantId, id);
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
    // Reactivation never restores a former staff role; staff roles are granted explicitly (review finding on #57).
    else if (membership.status !== "active") await tx.update(communityMemberships).set({ status: "active", role: "member", joinedAt: now, updatedAt: now }).where(where);
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
    // Only grants issued by the community's own ministry count (review finding on #57).
    const grants = await tx.select({ source: entitlements.source }).from(entitlements).where(and(
      eq(entitlements.tenantId, membership.tenantId), eq(entitlements.userId, viewerId), eq(entitlements.resourceType, "community"), eq(entitlements.resourceId, id),
      isNull(entitlements.revokedAt), lte(entitlements.validFrom, now), or(isNull(entitlements.validUntil), gt(entitlements.validUntil, now))));
    const role = membership.role as CommunityRole, sources = grants.map((g) => g.source).sort();
    return { allowed: communityStaffRoles.includes(role) || sources.length > 0, role, sources };
  });
}

const publishInput = z.object({ version: z.number().int().min(1), published: z.boolean() }).strict();

export function getCommunity(db: Database, userId: string, workspace: string, communityId: string) {
  const id = z.uuid().parse(communityId);
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:read", (tx, tenantId) => ownCommunity(tx, tenantId, id));
}

/** Members of one community for its ministry's owners and admins: display name, role and status only, never contact details. */
export function listCommunityMembers(db: Database, userId: string, workspace: string, communityId: string) {
  const id = z.uuid().parse(communityId);
  // The roster (including pending and banned people) is limited to managers, not every ministry role (review on #58).
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:manage", async (tx, tenantId) => {
    await ownCommunity(tx, tenantId, id);
    return tx.select({ userId: communityMemberships.userId, name: users.name, role: communityMemberships.role, status: communityMemberships.status })
      .from(communityMemberships).innerJoin(users, eq(users.id, communityMemberships.userId))
      .where(and(eq(communityMemberships.tenantId, tenantId), eq(communityMemberships.communityId, id)))
      .orderBy(asc(communityMemberships.createdAt));
  });
}

/** Publishes or unpublishes after the server-side checklist; archived communities can be neither published nor unpublished. */
export async function publishCommunity(db: Database, userId: string, workspace: string, communityId: string, raw: unknown) {
  const { version, published } = publishInput.parse(raw);
  const id = z.uuid().parse(communityId);
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:manage", async (tx, tenantId) => {
    const current = await ownCommunity(tx, tenantId, id);
    if (current.version !== version) throw new AccessError(409, message("Errors.communityChanged"));
    if (current.status === "archived" || (published && !readyToPublish(current))) throw new AccessError(409, message("Errors.communityNotReady"));
    const [row] = await tx.update(communities).set({ status: published ? "published" : "draft", version: version + 1, updatedAt: new Date() })
      .where(and(eq(communities.tenantId, tenantId), eq(communities.id, id), eq(communities.version, version))).returning();
    if (!row) throw new AccessError(409, message("Errors.communityChanged"));
    await syncListing(tx, tenantId, id);
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: published ? "community.publish" : "community.unpublish", targetId: id });
    return row;
  });
}

/**
 * Keeps the Discover projection in step with the community, in the caller's transaction (ADR 0013 §7):
 * a row exists only while the community is published, Listed, opted in and its ministry is eligible.
 */
export async function syncListing(tx: Transaction, tenantId: string, communityId: string) {
  const [c] = await tx.select().from(communities).where(and(eq(communities.tenantId, tenantId), eq(communities.id, communityId)));
  const [host] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.tenantId, tenantId));
  const listing = c && host ? listingFor(c, host.name, discoverEligible(tenantId)) : null;
  const key = and(eq(discoverListings.resourceType, "community"), eq(discoverListings.resourceId, communityId));
  if (!listing) { await tx.delete(discoverListings).where(key); return; }
  const values = { ...listing, updatedAt: new Date() };
  await tx.insert(discoverListings).values(values).onConflictDoUpdate({ target: [discoverListings.resourceType, discoverListings.resourceId], set: values });
}

const inviteInput = z.object({ email: z.email().max(320) }).strict();
const inviteDays = 14;
export type InviteStatus = "pending" | "redeemed" | "revoked" | "expired";

/** Creates a personal invitation link (C08). The token is returned once, inside the path; only hashes are stored. */
export async function createInvite(db: Database, userId: string, workspace: string, communityId: string, raw: unknown) {
  const { email } = inviteInput.parse(raw), id = z.uuid().parse(communityId);
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:manage", async (tx, tenantId) => {
    const community = await ownCommunity(tx, tenantId, id);
    const token = newInviteToken(), expiresAt = new Date(Date.now() + inviteDays * 864e5), hash = emailHash(email);
    // A new invitation for the same address replaces the open one (including an expired one).
    await tx.update(communityInvites).set({ revokedAt: new Date() }).where(and(eq(communityInvites.tenantId, tenantId), eq(communityInvites.communityId, id),
      eq(communityInvites.emailHash, hash), isNull(communityInvites.redeemedAt), isNull(communityInvites.revokedAt)));
    const [row] = await tx.insert(communityInvites).values({ tenantId, communityId: id, emailHash: hash, emailHint: emailHint(email),
      tokenHash: hashSecret(token), createdBy: userId, expiresAt }).returning();
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "community.invite_create", targetId: id, metadata: { inviteId: row.id } });
    return { id: row.id, path: `/communities/${community.slug}?invite=${token}`, expiresAt, emailHint: row.emailHint };
  });
}

export function listInvites(db: Database, userId: string, workspace: string, communityId: string) {
  const id = z.uuid().parse(communityId);
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:manage", async (tx, tenantId) => {
    await ownCommunity(tx, tenantId, id);
    const rows = await tx.select().from(communityInvites).where(and(eq(communityInvites.tenantId, tenantId), eq(communityInvites.communityId, id)))
      .orderBy(desc(communityInvites.createdAt)).limit(200);
    const now = Date.now();
    return rows.map((r) => ({ id: r.id, emailHint: r.emailHint, expiresAt: r.expiresAt,
      status: (r.redeemedAt ? "redeemed" : r.revokedAt ? "revoked" : r.expiresAt.getTime() <= now ? "expired" : "pending") as InviteStatus }));
  });
}

export async function revokeInvite(db: Database, userId: string, workspace: string, communityId: string, inviteId: string, raw: unknown) {
  z.object({}).strict().parse(raw);
  const id = z.uuid().parse(communityId), invite = z.uuid().parse(inviteId);
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:manage", async (tx, tenantId) => {
    const [row] = await tx.update(communityInvites).set({ revokedAt: new Date() }).where(and(eq(communityInvites.tenantId, tenantId), eq(communityInvites.communityId, id),
      eq(communityInvites.id, invite), isNull(communityInvites.redeemedAt), isNull(communityInvites.revokedAt))).returning();
    if (!row) throw new AccessError(404, message("Errors.inviteInvalid"));
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "community.invite_revoke", targetId: id, metadata: { inviteId: invite } });
  });
}
