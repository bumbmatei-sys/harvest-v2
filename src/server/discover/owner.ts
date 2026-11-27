import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { auditLogs, catalogItems, communities, discoverControls, discoverListings } from "../../db/schema";
import { discoverTypes, listingMetadata, type DiscoverType } from "../../lib/discover";
import { AccessError } from "../permissions";
import { withTenant } from "../tenancy";
import { message } from "../../i18n/messages";
import { refreshDiscoverListing } from "./refresh";
import { assertDiscoverEnabled, unavailable, type DiscoverDeps } from "./registry";

export class DiscoverValidationError extends Error {
  readonly status = 422;
  constructor(readonly details: Record<string, unknown>) { super(message("Errors.checkTheSuppliedDetails")); }
}
export const invalid = (code: string) => new DiscoverValidationError({ code });
export const conflict = (code = "STALE_VERSION") => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { code });
const recordId = (id: string) => { const p = z.uuid().safeParse(id); if (!p.success) throw unavailable(); return p.data; };

async function ministry<T>(db: Database, user: string, workspace: string, deps: DiscoverDeps, run: (tx: Transaction, tenant: string) => Promise<T>) {
  assertDiscoverEnabled(deps);
  try { return await withTenant(db, user, recordId(workspace), "catalog:manage", (tx, tenant) => run(tx, tenant)); }
  catch (error) { if (error instanceof AccessError && error.status === 403) throw unavailable(); throw error; }
}
const audit = (tx: Transaction, tenant: string, actor: string, action: string, target: string, metadata: Record<string, string> = {}) =>
  tx.insert(auditLogs).values({ tenantId: tenant, actorId: actor, action: `discover.${action}`, targetId: target, metadata });

type Control = typeof discoverControls.$inferSelect;
const view = (type: DiscoverType, id: string, name: string, published: boolean, optIn: boolean, listed: boolean, c: Control | undefined) => ({
  type, id, name, published, optIn, optInManagedBy: type === "community" ? "community_settings" as const : "listing" as const, category: c?.category ?? null, language: c?.language ?? null,
  review: { state: c?.reviewState ?? "not_requested" as const, reason: c?.reviewState === "rejected" || c?.reviewState === "suspended" ? c.reviewReason : null },
  // Whether the item is in the directory projection right now (published, listed, opted in). Public visibility also needs an approved review.
  listed, version: c?.version ?? 0,
});

/** The ministry's own view: every community, course and download with its Discover state. */
export function listMyListings(db: Database, user: string, workspace: string, deps: DiscoverDeps) {
  return ministry(db, user, workspace, deps, async (tx, tenant) => {
    const [comms, items, controls, listings] = await Promise.all([
      tx.select().from(communities).where(eq(communities.tenantId, tenant)).orderBy(asc(communities.name)),
      tx.select().from(catalogItems).where(eq(catalogItems.tenantId, tenant)).orderBy(asc(catalogItems.title)),
      tx.select().from(discoverControls).where(eq(discoverControls.tenantId, tenant)),
      tx.select({ type: discoverListings.resourceType, id: discoverListings.resourceId }).from(discoverListings).where(eq(discoverListings.tenantId, tenant)),
    ]);
    const control = (t: string, id: string) => controls.find(c => c.resourceType === t && c.resourceId === id);
    const listed = new Set(listings.map(l => `${l.type}:${l.id}`));
    return { items: [
      ...comms.map(c => view("community", c.id, c.name, c.status === "published" && c.visibility === "listed", c.discoverOptIn, listed.has(`community:${c.id}`), control("community", c.id))),
      ...items.map(i => { const t = i.kind === "course" ? "course" as const : "product" as const; const c = control(t, i.id);
        return view(t, i.id, i.title, i.state === "published" && (i.visibility === "listed" || i.visibility === "public"), c?.ownerOptIn ?? false, listed.has(`${t}:${i.id}`), c); }),
    ] };
  });
}

const changeInput = z.object({ version: z.number().int().min(0).max(2_147_483_646), optIn: z.boolean().optional(), requestReview: z.literal(true).optional() }).merge(listingMetadata).strict();
/**
 * Owner opt-in and metadata for one item. A community's opt-in is its canonical setting and is refused here (one source of truth). Opting in a qualifying item requests review;
 * opting out removes it from the directory at once and keeps any earlier approval for the same fields.
 */
export async function changeListing(db: Database, user: string, workspace: string, rawType: string, id: string, raw: unknown, deps: DiscoverDeps) {
  const type = z.enum(discoverTypes).safeParse(rawType);
  const input = changeInput.safeParse(raw);
  if (!type.success) throw unavailable();
  if (!input.success) throw invalid("DISCOVER_INVALID_INPUT");
  const data = input.data, kind = type.data;
  return ministry(db, user, workspace, deps, async (tx, tenant) => {
    const resource = recordId(id);
    if (kind === "community" && data.optIn !== undefined) throw invalid("OPT_IN_IN_COMMUNITY_SETTINGS");
    const exists = kind === "community"
      ? (await tx.select({ id: communities.id }).from(communities).where(and(eq(communities.tenantId, tenant), eq(communities.id, resource)))).length
      : (await tx.select({ id: catalogItems.id }).from(catalogItems).where(and(eq(catalogItems.tenantId, tenant), eq(catalogItems.id, resource), eq(catalogItems.kind, kind === "course" ? "course" : "download")))).length;
    if (!exists) throw unavailable();
    const key = and(eq(discoverControls.tenantId, tenant), eq(discoverControls.resourceType, kind), eq(discoverControls.resourceId, resource));
    const [before] = await tx.select({ version: discoverControls.version }).from(discoverControls).where(key).for("update");
    // Version 0 means the item has no Discover record yet; any other value must be the version the person saw.
    if ((before?.version ?? 0) !== data.version) throw conflict();
    await refreshDiscoverListing(tx, tenant, kind, resource);
    const [current] = await tx.select().from(discoverControls).where(key).for("update");
    if (!current) throw unavailable();
    const set: Partial<typeof discoverControls.$inferInsert> = { updatedBy: user, version: current.version + 1, updatedAt: new Date() };
    if (data.optIn !== undefined) set.ownerOptIn = data.optIn;
    if (data.category !== undefined) set.category = data.category;
    if (data.language !== undefined) set.language = data.language;
    if (data.requestReview && current.reviewState === "rejected") set.reviewState = "pending";
    // A pending request that is withdrawn (opt-out) goes back to not requested.
    if (data.optIn === false && current.reviewState === "pending") set.reviewState = "not_requested";
    await tx.update(discoverControls).set(set).where(and(eq(discoverControls.tenantId, tenant), eq(discoverControls.resourceType, kind), eq(discoverControls.resourceId, resource)));
    await refreshDiscoverListing(tx, tenant, kind, resource);
    await audit(tx, tenant, user, data.optIn === undefined ? "listing_update" : data.optIn ? "opt_in" : "opt_out", resource, { type: kind });
    const mine = (await listMine(tx, tenant)).find(i => i.type === kind && i.id === resource)!;
    return { listing: mine };
  });
}
async function listMine(tx: Transaction, tenant: string) {
  const [comms, items, controls, listings] = await Promise.all([
    tx.select().from(communities).where(eq(communities.tenantId, tenant)), tx.select().from(catalogItems).where(eq(catalogItems.tenantId, tenant)),
    tx.select().from(discoverControls).where(eq(discoverControls.tenantId, tenant)), tx.select({ type: discoverListings.resourceType, id: discoverListings.resourceId }).from(discoverListings).where(eq(discoverListings.tenantId, tenant))]);
  const listed = new Set(listings.map(l => `${l.type}:${l.id}`));
  const control = (t: string, id: string) => controls.find(c => c.resourceType === t && c.resourceId === id);
  return [...comms.map(c => view("community", c.id, c.name, c.status === "published" && c.visibility === "listed", c.discoverOptIn, listed.has(`community:${c.id}`), control("community", c.id))),
    ...items.map(i => { const t = i.kind === "course" ? "course" as const : "product" as const; const c = control(t, i.id); return view(t, i.id, i.title, i.state === "published" && (i.visibility === "listed" || i.visibility === "public"), c?.ownerOptIn ?? false, listed.has(`${t}:${i.id}`), c); })];
}
