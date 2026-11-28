import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { catalogItems, catalogLandings, communities, discoverControls, discoverListings, workspaces } from "../../db/schema";
import { materialHash, publicSummary, searchText, type DiscoverType } from "../../lib/discover";

type Source = { name: string; summary: string | null; slug: string; free: boolean; published: boolean; optIn: boolean | null; pricing: string; admission: string[]; tagline: string | null };

/**
 * Keeps the Discover control row and the unified projection in step with the canonical record, in the caller's transaction (communities and the free catalogue call this after
 * every change that can touch a public field). It never owns a community, course or product, and it never grants approval: a qualifying listing is simply requested for review,
 * and a material change to an approved (or rejected) listing sends it back to review.
 */
export async function refreshDiscoverListing(tx: Transaction, tenant: string, type: DiscoverType, id: string) {
  const source = await load(tx, tenant, type, id);
  const key = and(eq(discoverListings.resourceType, type), eq(discoverListings.resourceId, id));
  if (!source) { if (type !== "community") await tx.delete(discoverListings).where(key); return; }
  const [host] = await tx.select({ name: workspaces.name, audience: workspaces.audience }).from(workspaces).where(eq(workspaces.tenantId, tenant));
  if (!host) return;
  await tx.insert(discoverControls).values({ tenantId: tenant, resourceType: type, resourceId: id }).onConflictDoNothing();
  const [control] = await tx.select().from(discoverControls).where(and(eq(discoverControls.tenantId, tenant), eq(discoverControls.resourceType, type), eq(discoverControls.resourceId, id))).for("update");
  const optIn = type === "community" ? !!source.optIn : control.ownerOptIn;
  const qualifies = source.published && optIn;
  const hash = materialHash({ type, name: source.name, summary: source.summary, category: control.category, language: control.language, free: source.free, host: host.name, audience: host.audience });
  // The review state only ever moves toward review here; approving, rejecting and suspending belong to the platform.
  const reviewMoved = qualifies && (control.reviewState === "not_requested" || ((control.reviewState === "approved" || control.reviewState === "rejected") && control.reviewedHash !== hash));
  if (control.currentHash !== hash || reviewMoved) {
    await tx.update(discoverControls).set({ currentHash: hash, ...(reviewMoved ? { reviewState: "pending" as const } : {}), version: sql`${discoverControls.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(discoverControls.tenantId, tenant), eq(discoverControls.resourceType, type), eq(discoverControls.resourceId, id)));
  }
  const extras = { summary: publicSummary(source.summary), category: control.category, language: control.language, audience: host.audience, isFree: source.free, contentHash: hash };
  if (type === "community") {
    if (qualifies) await tx.update(discoverListings).set(extras).where(key);
    return;
  }
  if (!qualifies) { await tx.delete(discoverListings).where(key); return; }
  const [existing] = await tx.select({ hash: discoverListings.contentHash }).from(discoverListings).where(key);
  const values = { resourceType: type, resourceId: id, tenantId: tenant, slug: source.slug, name: source.name, tagline: null, hostName: host.name, pricing: source.pricing, admission: source.admission,
    searchText: searchText([source.name, source.summary, host.name]), ...extras };
  // The "newest" order moves only when a public field really changed.
  await tx.insert(discoverListings).values({ ...values, updatedAt: new Date() }).onConflictDoUpdate({ target: [discoverListings.resourceType, discoverListings.resourceId],
    set: existing?.hash === hash ? { ...values } : { ...values, updatedAt: new Date() } });
}

async function load(tx: Transaction, tenant: string, type: DiscoverType, id: string): Promise<Source | null> {
  if (type === "community") {
    const [c] = await tx.select().from(communities).where(and(eq(communities.tenantId, tenant), eq(communities.id, id)));
    return c ? { name: c.name, summary: c.tagline, tagline: c.tagline, slug: c.slug, free: c.pricing === "free", pricing: c.pricing, admission: [], published: c.status === "published" && c.visibility === "listed", optIn: c.discoverOptIn } : null;
  }
  const [item] = await tx.select().from(catalogItems).where(and(eq(catalogItems.tenantId, tenant), eq(catalogItems.id, id), eq(catalogItems.kind, type === "course" ? "course" : "download")));
  if (!item) return null;
  // A price on the landing page (shown only; checkout stays off until the ministry can take payments) lists the item as paid.
  const [landing] = await tx.select({ price: catalogLandings.priceCents }).from(catalogLandings).where(and(eq(catalogLandings.tenantId, tenant), eq(catalogLandings.itemId, id)));
  const free = landing?.price == null;
  return { name: item.title, summary: item.summary, tagline: null, slug: item.slug, free, pricing: free ? "free" : "paid", admission: [], published: item.state === "published" && (item.visibility === "listed" || item.visibility === "public"), optIn: null };
}
