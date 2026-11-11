import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { communities, communityMemberships, workspaceMembers } from "../db/schema";
import { hashSecret } from "../lib/community-listing";
import { can } from "../lib/permissions";
import { message } from "../i18n/messages";
import { communitySlug, listCommunities } from "./communities";
import { AccessError } from "./permissions";
import { withUser } from "./tenancy";

// PR 3 (C05/C06/C08). Visitors and members never query community tables directly: public page data, Discover and
// joining go through the SECURITY DEFINER functions of migration 0036, which return only public fields.
export type PublicCommunity = { id: string; slug: string; name: string; tagline: string | null; description: string | null; hostName: string; pricing: string;
  visibility: string; allowOpen: boolean; allowApply: boolean; allowInvite: boolean; rules: string | null; rulesVersion: number; invited: boolean };
export type DiscoverItem = { id: string; slug: string; name: string; tagline: string | null; hostName: string; pricing: string; admission: string[]; updatedAt: string };
const inviteToken = z.string().regex(/^[a-f0-9]{64}$/);

/** Public page data, or null when the community is not published or not visible (hidden without a valid invitation). */
export async function getPublicCommunity(db: Database, slug: string, invite?: string): Promise<PublicCommunity | null> {
  const parsed = communitySlug.safeParse(slug);
  if (!parsed.success) return null;
  const hash = invite && inviteToken.safeParse(invite).success ? hashSecret(invite) : null;
  return db.transaction(async (tx) => (await tx.execute<{ v: PublicCommunity | null }>(sql`select public.community_public(${parsed.data}, ${hash}) as v`)).rows[0]?.v ?? null);
}

const enterInput = z.object({ rulesVersion: z.number().int().min(0), adult: z.boolean(), invite: inviteToken.optional(), inviteId: z.uuid().optional() }).strict();
// Not found, wrong address, expired and revoked invitations share one answer; so do "closed" and "banned".
const refusals = {
  not_found: () => new AccessError(404, message("Errors.communityNotFound")),
  invite_invalid: () => new AccessError(404, message("Errors.inviteInvalid")),
  rules_changed: () => new AccessError(409, message("Errors.communityRulesChanged")),
  adult_required: () => new AccessError(409, message("Errors.adultConfirmationRequired")),
  not_allowed: () => new AccessError(409, message("Errors.communityJoinUnavailable")),
  banned: () => new AccessError(409, message("Errors.communityJoinUnavailable")),
} as const;

/** Open join, or redemption of a personal invitation (by link token or, from the account page, by id). */
export async function enterCommunity(db: Database, userId: string, slug: string, raw: unknown) {
  const input = enterInput.parse(raw), parsed = communitySlug.parse(slug);
  const outcome = await withUser(db, userId, async (tx) => (await tx.execute<{ o: string }>(sql`select public.community_enter(${parsed}, ${input.rulesVersion},
    ${input.adult}, ${input.invite ? hashSecret(input.invite) : null}, ${input.inviteId ?? null}::uuid) as o`)).rows[0].o);
  if (outcome === "joined" || outcome === "already_member") return { outcome } as const;
  throw (refusals[outcome as keyof typeof refusals] ?? refusals.not_allowed)();
}

/** The community, if the caller is an active member (member RLS path); otherwise null. */
export async function activeMembership(db: Database, userId: string, slug: string) {
  const parsed = communitySlug.safeParse(slug);
  if (!parsed.success) return null;
  return withUser(db, userId, async (tx) => {
    const [row] = await tx.select({ id: communities.id, name: communities.name, slug: communities.slug, rules: communities.rules }).from(communities)
      .innerJoin(communityMemberships, and(eq(communityMemberships.tenantId, communities.tenantId), eq(communityMemberships.communityId, communities.id)))
      .where(and(eq(communities.slug, parsed.data), eq(communityMemberships.userId, userId), eq(communityMemberships.status, "active")));
    return row ?? null;
  });
}

const discoverInput = z.object({ q: z.string().trim().max(80).optional(), open: z.boolean().optional(), after: z.string().max(200).optional() }).strict();
export const discoverPageSize = 24;

export async function listDiscover(db: Database, raw: unknown) {
  const input = discoverInput.parse(raw);
  let after: string | null = null, afterId: string | null = null;
  if (input.after) {
    const [at, id] = Buffer.from(input.after, "base64url").toString().split("|");
    if (at && !Number.isNaN(new Date(at).getTime()) && z.uuid().safeParse(id).success) { after = at; afterId = id; }
  }
  const rows = await db.transaction(async (tx) => (await tx.execute<{ v: DiscoverItem }>(sql`select public.discover_communities(${input.q ?? ""},
    ${input.open ?? false}, ${after}::timestamptz, ${afterId}::uuid, ${discoverPageSize + 1}) as v`)).rows.map((r) => r.v));
  const items = rows.slice(0, discoverPageSize), last = items.at(-1);
  return { items, next: rows.length > discoverPageSize && last ? Buffer.from(`${last.updatedAt}|${last.id}`).toString("base64url") : null };
}

export type MyInvite = { inviteId: string; slug: string; name: string; expiresAt: string; rules: string | null; rulesVersion: number };

/** Joined (member path), Invited (definer, matched to the verified email) and Hosted (staff path per ministry). */
export async function myCommunities(db: Database, userId: string) {
  const { joined, invited, managed } = await withUser(db, userId, async (tx) => ({
    joined: await tx.select({ slug: communities.slug, name: communities.name, role: communityMemberships.role }).from(communityMemberships)
      .innerJoin(communities, and(eq(communities.tenantId, communityMemberships.tenantId), eq(communities.id, communityMemberships.communityId)))
      .where(and(eq(communityMemberships.userId, userId), eq(communityMemberships.status, "active"), eq(communities.status, "published")))
      .orderBy(communities.name),
    invited: (await tx.execute<{ v: MyInvite }>(sql`select public.community_my_invites() as v`)).rows.map((r) => r.v),
    managed: (await tx.select({ tenantId: workspaceMembers.tenantId, role: workspaceMembers.roleId }).from(workspaceMembers).where(eq(workspaceMembers.userId, userId)))
      .filter((m) => can(m.role, "communities:manage")).map((m) => m.tenantId),
  }));
  const hosted = (await Promise.all(managed.map((tenantId) => listCommunities(db, userId, tenantId))))
    .flat().map((c) => ({ tenantId: c.tenantId, id: c.id, name: c.name, status: c.status }));
  return { joined, invited, hosted };
}
