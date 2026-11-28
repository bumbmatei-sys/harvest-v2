import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { campaigns, campaignResponseLinks, communities, connectCommunityJoinCounts, connectLandingStates, connectLandingVersions } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { emptyLanding, landingDefinition, landingExpectation, saveLandingInput, type LandingCommunity, type LandingDefinition } from "../lib/connect-landing";
import { suppressSmall } from "../lib/connect-retention";
import { message } from "../i18n/messages";
import { AccessError, can } from "./permissions";
import { withTenant } from "./tenancy";

async function read(tx: Transaction, tenantId: string, campaignId: string, linkId: string, role: string) {
  const [link] = await tx.select({ publicCode: campaignResponseLinks.publicCode, title: campaignResponseLinks.publicTitle,
    status: campaignResponseLinks.status, archivedAt: campaigns.archivedAt }).from(campaignResponseLinks)
    .innerJoin(campaigns, and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaignResponseLinks.campaignId)))
    .where(and(eq(campaignResponseLinks.tenantId, tenantId), eq(campaignResponseLinks.campaignId, campaignId), eq(campaignResponseLinks.id, linkId)));
  if (!link) throw new AccessError(404, message("Connect.linkNotFound"));
  const [state] = await tx.select().from(connectLandingStates).where(and(eq(connectLandingStates.tenantId, tenantId), eq(connectLandingStates.linkId, linkId)));
  const [published] = state?.publishedRevision ? await tx.select({ definition: connectLandingVersions.definition, revision: connectLandingVersions.revision })
    .from(connectLandingVersions).where(and(eq(connectLandingVersions.tenantId, tenantId), eq(connectLandingVersions.linkId, linkId), eq(connectLandingVersions.revision, state.publishedRevision))) : [];
  const editable = !link.archivedAt && link.status !== "archived";
  return { definition: state?.definition ?? emptyLanding, communities: await recommendable(tx, tenantId), revision: state?.revision ?? 0, expectedCode: link.publicCode,
    published: published ?? null, title: link.title, permissions: { edit: editable && can(role, "campaigns:write"), publish: editable && can(role, "connect:publish") } };
}
/** C20: the ministry's own communities that may be recommended on a QR page (published and listed), read under the tenant's staff policy. */
function recommendable(tx: Transaction, tenantId: string): Promise<({ id: string } & LandingCommunity)[]> {
  return tx.select({ id: communities.id, slug: communities.slug, name: communities.name, tagline: communities.tagline }).from(communities)
    .where(and(eq(communities.tenantId, tenantId), eq(communities.status, "published"), eq(communities.visibility, "listed"))).orderBy(communities.name).limit(200);
}
export type EditableLanding = Awaited<ReturnType<typeof getLanding>>;
export async function getLanding(db: Database, user: string, tenant: string, campaign: string, link: string) {
  const tenantId = uuidInput.parse(tenant), campaignId = uuidInput.parse(campaign), linkId = uuidInput.parse(link);
  return withTenant(db, user, tenantId, "campaigns:write", (tx, id, role) => read(tx, id, campaignId, linkId, role));
}
export async function writeLanding(db: Database, user: string, tenant: string, campaign: string, link: string, body: unknown, publish = false) {
  const tenantId = uuidInput.parse(tenant), campaignId = uuidInput.parse(campaign), linkId = uuidInput.parse(link);
  const input = publish ? landingExpectation.parse(body) : saveLandingInput.parse(body);
  return withTenant(db, user, tenantId, publish ? "connect:publish" : "campaigns:write", async (tx, id, role) => {
    const definition = "definition" in input ? JSON.stringify(input.definition) : null;
    // The guest page re-checks the community on every read; this only stops a ministry saving one that is not its own published, listed community.
    const chosen = publish ? undefined : (input as unknown as { definition: LandingDefinition }).definition.communityId;
    if (chosen && !(await recommendable(tx, id)).some(c => c.id === chosen))
      throw new AccessError(400, message("LandingEditor.invalid"));
    const { rows } = await tx.execute<{ outcome: string }>(sql`select public.connect_landing_write(${id}::uuid,${campaignId}::uuid,${linkId}::uuid,
      ${input.expectedRevision}::integer,${input.expectedCode},${definition}::jsonb,${publish}) as outcome`);
    const outcome = rows[0].outcome;
    if (outcome === "not_found") throw new AccessError(404, message("Connect.linkNotFound"));
    if (outcome === "invalid") throw new AccessError(400, message("LandingEditor.invalid"));
    if (!["saved", "published", "unchanged"].includes(outcome)) throw new AccessError(409, message("LandingEditor.conflict"), { reason: outcome });
    return { ...await read(tx, id, campaignId, linkId, role), outcome };
  });
}
/** Anonymous projection: ownership comes only from the opaque current code. No cross-request cache. */
export async function resolvePublishedLanding(db: Database, kind: "qr" | "short", code: string) {
  try {
    const { rows } = await db.execute<{ locale: string | null; public_title: string | null; definition: LandingDefinition | null }>(
      sql`select locale,public_title,definition from public.resolve_connect_landing(${kind},${code})`);
    const row = rows[0];
    if (!row) return undefined;
    // Fail closed on malformed stored presentation; never substitute private draft content.
    const parsed = row.definition ? landingDefinition.parse(row.definition) : undefined;
    // The stored community id never leaves the server: the guest gets the public fields of a community that still qualifies, or nothing.
    const { communityId, ...definition } = parsed ?? { communityId: undefined };
    const community = communityId ? await resolveLandingCommunity(db, kind, code) : undefined;
    return { locale: row.locale, title: row.public_title, definition: parsed ? definition as LandingDefinition : undefined, ...(community ? { community } : {}) };
  } catch { console.error("connect_landing_resolve_failed"); return undefined; }
}
/** C20: the recommended community of the current published snapshot, only while it is published, listed, the ministry's own and not suspended by Harvest. */
async function resolveLandingCommunity(db: Database, kind: "qr" | "short", code: string): Promise<LandingCommunity | undefined> {
  const { rows } = await db.execute<{ community_slug: string; community_name: string; community_tagline: string | null }>(
    sql`select community_slug,community_name,community_tagline from public.resolve_connect_landing_community(${kind},${code})`);
  const row = rows[0];
  return row ? { slug: row.community_slug, name: row.community_name, tagline: row.community_tagline } : undefined;
}
/** C20: per QR link, how many joins started from its recommended community. Counts only (no person), with the Connect small-group rule: 1 to 4 shows as null. */
export async function landingJoinCounts(db: Database, user: string, tenant: string, campaign: string): Promise<Record<string, number | null>> {
  const tenantId = uuidInput.parse(tenant), campaignId = uuidInput.parse(campaign);
  return withTenant(db, user, tenantId, "campaigns:write", async (tx, id) => {
    const rows = await tx.select({ linkId: connectCommunityJoinCounts.linkId, joins: sql<number>`sum(${connectCommunityJoinCounts.joins})::int` }).from(connectCommunityJoinCounts)
      .innerJoin(campaignResponseLinks, and(eq(campaignResponseLinks.tenantId, connectCommunityJoinCounts.tenantId), eq(campaignResponseLinks.id, connectCommunityJoinCounts.linkId)))
      .where(and(eq(connectCommunityJoinCounts.tenantId, id), eq(campaignResponseLinks.campaignId, campaignId))).groupBy(connectCommunityJoinCounts.linkId);
    return Object.fromEntries(rows.map(r => [r.linkId, suppressSmall(r.joins)]));
  });
}
/** C20: called by the community join in the same transaction, right after a new membership. Adds one to the count when the code's published page recommends this community. */
export async function countLandingJoin(tx: Transaction, code: string, slug: string) {
  try {
    return await tx.transaction(async (inner) => (await inner.execute<{ ok: boolean }>(sql`select public.connect_count_community_join(${code}, ${slug}) as ok`)).rows[0]?.ok === true);
  } catch { console.error("connect_join_count_failed"); return false; }
}
