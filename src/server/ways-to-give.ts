import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, givingMethods, givingStanding } from "../db/schema";
import { message } from "../i18n/messages";
import { handleProblem } from "../lib/link-in-bio";
import { givingLimits, givingMethodInputSchema, givingReportSchema, publicGivingMethods, type GivingKind, type GivingPublicMethod } from "../lib/ways-to-give";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";
import { waysToGiveEnabled } from "./ways-to-give-mode";

// Ways to give (CW-10). Owner/admin management of the ministry's own giving accounts, and the public read of enabled methods. Nothing here contacts a
// provider, fetches a link or records a gift (pledges, recorded gifts and totals belong to the fundraising module).

export function requireWaysToGiveEnabled() { if (!waysToGiveEnabled()) throw new AccessError(404, message("Errors.thisViewIsNotAvailable")); }
const uuid = z.uuid();
const stale = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
const missing = () => new AccessError(404, message("Errors.thisViewIsNotAvailable"));

export type GivingMethod = GivingPublicMethod & { position: number; enabled: boolean; version: number; updatedAt: string };
const columns = { id: givingMethods.id, kind: givingMethods.kind, label: givingMethods.label, url: givingMethods.url, handle: givingMethods.handle, iban: givingMethods.iban,
  bic: givingMethods.bic, accountHolder: givingMethods.accountHolder, note: givingMethods.note, position: givingMethods.position, enabled: givingMethods.enabled,
  version: givingMethods.version, updatedAt: givingMethods.updatedAt };
type Row = { id: string; kind: GivingKind; label: string; url: string | null; handle: string | null; iban: string | null; bic: string | null; accountHolder: string | null; note: string | null;
  position: number; enabled: boolean; version: number; updatedAt: Date };
const toMethod = (row: Row): GivingMethod => ({ ...row, updatedAt: row.updatedAt.toISOString() });
/** Field names only: account numbers and handles never go into the audit log. */
const changed = (before: Row, after: Row) => (["kind", "label", "url", "handle", "iban", "bic", "accountHolder", "note", "enabled"] as const).filter((key) => before[key] !== after[key]).join(",");

export async function listGivingMethods(db: Database, user: string, workspace: string): Promise<GivingMethod[]> {
  requireWaysToGiveEnabled();
  return withTenant(db, user, uuid.parse(workspace), "giving:manage", async (tx, tenantId) =>
    (await tx.select(columns).from(givingMethods).where(eq(givingMethods.tenantId, tenantId)).orderBy(asc(givingMethods.position), asc(givingMethods.id))).map(toMethod));
}

export async function createGivingMethod(db: Database, user: string, workspace: string, raw: unknown): Promise<GivingMethod> {
  requireWaysToGiveEnabled();
  const input = givingMethodInputSchema.parse(raw);
  return withTenant(db, user, uuid.parse(workspace), "giving:manage", async (tx, tenantId) => {
    // One writer at a time per ministry, so the limit and the next position hold under concurrent adds.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`giving_methods:${tenantId}`}, 0))`);
    const [{ n, next }] = await tx.select({ n: sql<number>`count(*)::int`, next: sql<number>`coalesce(max(${givingMethods.position}) + 1, 0)::int` }).from(givingMethods).where(eq(givingMethods.tenantId, tenantId));
    if (Number(n) >= givingLimits.methods) throw new AccessError(409, message("Errors.waysToGiveLimit"), { reason: "limit" });
    const [row] = await tx.insert(givingMethods).values({ tenantId, ...input, position: Math.min(Number(next), 1000), createdBy: user }).returning(columns);
    await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "giving.method.create", targetId: row.id, metadata: { kind: row.kind, enabled: String(row.enabled) } });
    return toMethod(row);
  });
}

const updateInput = z.object({ version: z.number().int().min(1).max(2147483646), method: z.unknown() }).strict();
export async function updateGivingMethod(db: Database, user: string, workspace: string, id: string, raw: unknown): Promise<GivingMethod> {
  requireWaysToGiveEnabled();
  const { version, method } = updateInput.parse(raw);
  const input = givingMethodInputSchema.parse(method);
  const methodId = uuid.parse(id);
  return withTenant(db, user, uuid.parse(workspace), "giving:manage", async (tx, tenantId) => {
    const [before] = await tx.select(columns).from(givingMethods).where(and(eq(givingMethods.tenantId, tenantId), eq(givingMethods.id, methodId))).for("update");
    if (!before) throw missing();
    if (before.version !== version) throw stale();
    const [row] = await tx.update(givingMethods).set({ ...input, version: before.version + 1, updatedAt: new Date() })
      .where(and(eq(givingMethods.tenantId, tenantId), eq(givingMethods.id, methodId), eq(givingMethods.version, version))).returning(columns);
    if (!row) throw stale();
    await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "giving.method.update", targetId: row.id, metadata: { kind: row.kind, fields: changed(before, row), version: String(row.version) } });
    return toMethod(row);
  });
}

export async function deleteGivingMethod(db: Database, user: string, workspace: string, id: string): Promise<{ id: string }> {
  requireWaysToGiveEnabled();
  const methodId = uuid.parse(id);
  return withTenant(db, user, uuid.parse(workspace), "giving:manage", async (tx, tenantId) => {
    const rows = await tx.delete(givingMethods).where(and(eq(givingMethods.tenantId, tenantId), eq(givingMethods.id, methodId))).returning({ id: givingMethods.id, kind: givingMethods.kind });
    if (!rows.length) throw missing();
    await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "giving.method.delete", targetId: rows[0].id, metadata: { kind: rows[0].kind } });
    return { id: rows[0].id };
  });
}

const orderInput = z.object({ ids: z.array(z.uuid()).min(1).max(givingLimits.methods) }).strict().refine((value) => new Set(value.ids).size === value.ids.length);
/** The whole new order: every current method exactly once (anything else is stale). */
export async function reorderGivingMethods(db: Database, user: string, workspace: string, raw: unknown): Promise<GivingMethod[]> {
  requireWaysToGiveEnabled();
  const { ids } = orderInput.parse(raw);
  return withTenant(db, user, uuid.parse(workspace), "giving:manage", async (tx, tenantId) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`giving_methods:${tenantId}`}, 0))`);
    const current = await tx.select({ id: givingMethods.id }).from(givingMethods).where(eq(givingMethods.tenantId, tenantId)).for("update");
    if (current.length !== ids.length || current.some((row) => !ids.includes(row.id))) throw stale();
    for (const [position, id] of ids.entries()) {
      await tx.update(givingMethods).set({ position, updatedAt: new Date() }).where(and(eq(givingMethods.tenantId, tenantId), eq(givingMethods.id, id)));
    }
    await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "giving.method.reorder", targetId: tenantId, metadata: { count: String(ids.length) } });
    return (await tx.select(columns).from(givingMethods).where(eq(givingMethods.tenantId, tenantId)).orderBy(asc(givingMethods.position), asc(givingMethods.id))).map(toMethod);
  });
}

// ---- Public ----------------------------------------------------------------------------------------------------------------------------------------------
/**
 * Enabled methods of a ministry for a public page that is being shown (the caller has already resolved a published page of this ministry, such as a published
 * campaign). Enabled means public; anything that no longer validates is dropped. Empty while the module is off.
 */
export async function publicGivingMethodsFor(db: Database | Transaction, tenantId: string, env: Record<string, string | undefined> = process.env): Promise<GivingPublicMethod[]> {
  if (!waysToGiveEnabled(env) || !uuid.safeParse(tenantId).success) return [];
  const { rows: [row] } = await db.execute<{ result: unknown }>(sql`select public.giving_public_methods(${tenantId}::uuid) as result`);
  return publicGivingMethods(row?.result);
}

/** The methods of a published link-in-bio page's shown "Ways to give" block, or [] (unpublished, block hidden or absent, nothing enabled, module off). */
export async function bioGivingMethods(db: Database, handle: string, env: Record<string, string | undefined> = process.env): Promise<GivingPublicMethod[]> {
  if (!waysToGiveEnabled(env)) return [];
  const { rows: [row] } = await db.execute<{ result: unknown }>(sql`select public.bio_public_giving(${handle}) as result`);
  return publicGivingMethods(row?.result);
}

// ---- Staff takedown (owner side) --------------------------------------------------------------------------------------------------------------------------
export type GivingStanding = { hidden: boolean; reason: string | null; changedAt: string | null };
/** Whether Harvest staff hid this ministry's public giving details (owners and admins see it on their screen). */
export async function givingStandingFor(db: Database, user: string, workspace: string): Promise<GivingStanding> {
  requireWaysToGiveEnabled();
  return withTenant(db, user, uuid.parse(workspace), "giving:manage", async (tx, tenantId) => {
    const [row] = await tx.select({ hidden: givingStanding.hidden, reason: givingStanding.reason, changedAt: givingStanding.changedAt }).from(givingStanding).where(eq(givingStanding.tenantId, tenantId));
    return row ? { hidden: row.hidden, reason: row.hidden ? row.reason : null, changedAt: row.changedAt.toISOString() } : { hidden: false, reason: null, changedAt: null };
  });
}

// ---- Visitor reports ---------------------------------------------------------------------------------------------------------------------------------------
export type GivingReportOutcome = "ok" | "invalid" | "not_found" | "limited";
/**
 * A visitor reports a page that shows Ways to give. No account; the visitor key is a keyed hash that lives only in a one-minute counter, as for link-in-bio
 * clicks and messages. A filled honeypot is accepted and dropped. Nothing is sent to anyone.
 */
export async function submitBioGivingReport(db: Database, handle: string, raw: unknown, visitor: string, env: Record<string, string | undefined> = process.env): Promise<GivingReportOutcome> {
  if (!waysToGiveEnabled(env)) return "not_found";
  const parsed = givingReportSchema.safeParse(raw);
  if (!parsed.success) return "invalid";
  const input = parsed.data;
  if (input.website) return "ok";
  if (handleProblem(handle) !== null) return "not_found";
  const { rows: [row] } = await db.execute<{ result: GivingReportOutcome }>(sql`select public.bio_report_giving(${handle}, ${input.reason}, ${input.note ?? null}, ${visitor}) as result`);
  return row.result;
}
