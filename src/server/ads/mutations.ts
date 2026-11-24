import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { adsOperations } from "../../db/schema";
import { bulkStatusInput, budgetInput, canMove, deleteInput, renameInput, statusInput, type AdLevel, type AdStatus } from "../../lib/ads/ads";
import { audit, entityTables, failureCode, invalid, isAmbiguous, loadAccount, loadEntity, parse, providerAccess, recordId, stale, unavailable, withAds, type Access } from "./access";
import type { AdsDeps } from "./registry";

type Entity = Awaited<ReturnType<typeof loadEntity>>;
type Op = typeof adsOperations.$inferSelect;
type Plan<T> = { op: Op["op"]; key: string; adAccountId: string; targetLevel: AdLevel | null; targetId: string | null; summary: Record<string, unknown>; call: (access: Access) => Promise<T>; apply: (tx: Transaction, tenant: string, result: T) => Promise<void> };

/**
 * Two-phase spend-affecting change. Phase one authorises, checks the version and records the idempotency key; the provider is called with no transaction open;
 * phase two applies the result locally and audits ids, versions and the outcome only. A timeout after the provider may have acted leaves the operation `ambiguous`:
 * the same key can be retried and the provider answers with the original result.
 */
async function run<T>(db: Database, user: string, workspace: string, deps: AdsDeps, id: { key: string; op: Op["op"]; target: string | null }, prepare: (tx: Transaction, tenant: string) => Promise<Plan<T>>) {
  const claim = await withAds(db, user, workspace, deps, async (tx, tenant) => {
    // An already applied key is answered before any version check: the replay of a finished change is not a conflict.
    const [done] = await tx.select().from(adsOperations).where(and(eq(adsOperations.tenantId, tenant), eq(adsOperations.idempotencyKey, id.key), eq(adsOperations.status, "applied")));
    if (done) { if (done.op !== id.op || done.targetId !== id.target) throw stale("KEY_MISMATCH"); return { replay: true as const, status: done.status }; }
    const plan = await prepare(tx, tenant);
    const ctx = await loadAccount(tx, tenant, plan.adAccountId);
    if (ctx.account.status === "closed" || ctx.account.status === "disabled") throw invalid("ACCOUNT_NOT_ACTIVE");
    const access = providerAccess(ctx, deps);
    const [inserted] = await tx.insert(adsOperations).values({ tenantId: tenant, adAccountId: plan.adAccountId, idempotencyKey: plan.key, op: plan.op, targetLevel: plan.targetLevel, targetId: plan.targetId, summary: plan.summary, actorId: user })
      .onConflictDoNothing().returning({ id: adsOperations.id });
    if (!inserted) {
      const [existing] = await tx.select().from(adsOperations).where(and(eq(adsOperations.tenantId, tenant), eq(adsOperations.idempotencyKey, plan.key)));
      if (!existing || existing.op !== plan.op || existing.targetId !== plan.targetId || existing.adAccountId !== plan.adAccountId) throw stale("KEY_MISMATCH");
      if (existing.status === "applied") return { replay: true as const, status: existing.status };
      // Pending, failed and ambiguous operations are retried under the same key.
      await tx.update(adsOperations).set({ status: "pending", errorCode: null, updatedAt: sql`now()` }).where(and(eq(adsOperations.tenantId, tenant), eq(adsOperations.id, existing.id)));
    }
    return { replay: false as const, plan, access, tenant };
  });
  if (claim.replay) return { applied: true, replayed: true };
  let result: T | null = null, code: string | null = null, ambiguous = false, ok = false;
  try { result = await claim.plan.call(claim.access); ok = true; } catch (error) { code = failureCode(error); ambiguous = isAmbiguous(error); }
  const finished = await withAds(db, user, workspace, deps, async (tx, tenant) => {
    const { plan } = claim;
    if (!ok) {
      await tx.update(adsOperations).set({ status: ambiguous ? "ambiguous" : "failed", errorCode: code, updatedAt: sql`now()` }).where(and(eq(adsOperations.tenantId, tenant), eq(adsOperations.idempotencyKey, plan.key)));
      await audit(tx, tenant, user, `${plan.op}_outcome`, plan.targetId ?? plan.adAccountId, { outcome: ambiguous ? "ambiguous" : "failed", code: code ?? "ERROR" });
      return { failure: ambiguous ? "OUTCOME_UNKNOWN_RETRY_SAME_KEY" : `PROVIDER_${code}` };
    }
    await plan.apply(tx, tenant, result as T);
    await tx.update(adsOperations).set({ status: "applied", updatedAt: sql`now()` }).where(and(eq(adsOperations.tenantId, tenant), eq(adsOperations.idempotencyKey, plan.key)));
    await audit(tx, tenant, user, `${plan.op}_outcome`, plan.targetId ?? plan.adAccountId, { outcome: "applied", ...Object.fromEntries(Object.entries(plan.summary).map(([k, v]) => [k, String(v)])) });
    return { failure: null };
  });
  // The failed or ambiguous outcome is committed (and audited) before the caller sees the refusal.
  if (finished.failure) throw invalid(finished.failure);
  return { applied: true, replayed: false };
}
const remoteRef = (e: Entity) => { if (!e.externalRef) throw invalid("NOT_SYNCED"); return e.externalRef; };
const bump = { version: sql`version + 1`, updatedAt: sql`now()` };
async function setEntity(tx: Transaction, tenant: string, level: AdLevel, id: string, values: Record<string, unknown>) {
  const table = entityTables[level] as typeof entityTables.campaign;
  await tx.update(table).set({ ...values, ...bump } as never).where(and(eq(table.tenantId, tenant), eq(table.id, id)));
}
async function target(tx: Transaction, tenant: string, level: AdLevel, id: string, version: number) {
  const e = await loadEntity(tx, tenant, level, id, true);
  if (e.version !== version) throw stale();
  return e;
}

export async function setStatus(db: Database, user: string, workspace: string, data: unknown, deps: AdsDeps) {
  const input = parse(statusInput, data);
  return run(db, user, workspace, deps, { key: input.idempotencyKey, op: "status", target: input.id }, async (tx, tenant): Promise<Plan<void>> => {
    const e = await target(tx, tenant, input.level, input.id, input.version);
    if (!canMove(e.status as AdStatus, input.status)) throw invalid("STATUS_NOT_ALLOWED");
    const ref = remoteRef(e);
    return { op: "status", key: input.idempotencyKey, adAccountId: e.adAccountId, targetLevel: input.level, targetId: e.id, summary: { level: input.level, status: input.status, version: e.version },
      call: (a) => a.provider.setStatus(a.credential, { ...a.query, idempotencyKey: input.idempotencyKey, level: input.level, ref, status: input.status }),
      apply: (t, tn) => setEntity(t, tn, input.level, e.id, { status: input.status }) };
  });
}

export async function bulkSetStatus(db: Database, user: string, workspace: string, data: unknown, deps: AdsDeps) {
  const input = parse(bulkStatusInput, data);
  return run(db, user, workspace, deps, { key: input.idempotencyKey, op: "bulk_status", target: null }, async (tx, tenant): Promise<Plan<void>> => {
    const loaded: { level: AdLevel; e: Entity }[] = [];
    if (new Set(input.items.map(i => `${i.level}:${i.id}`)).size !== input.items.length) throw invalid("DUPLICATE_ITEMS");
    for (const item of input.items) {
      const e = await target(tx, tenant, item.level, item.id, item.version);
      if (!canMove(e.status as AdStatus, input.status)) throw invalid("STATUS_NOT_ALLOWED");
      loaded.push({ level: item.level, e });
    }
    if (new Set(loaded.map(l => l.e.adAccountId)).size !== 1) throw invalid("MIXED_ACCOUNTS");
    const items = loaded.map(l => ({ level: l.level, ref: remoteRef(l.e) }));
    return { op: "bulk_status", key: input.idempotencyKey, adAccountId: loaded[0].e.adAccountId, targetLevel: null, targetId: null, summary: { count: items.length, status: input.status },
      call: (a) => a.provider.bulkSetStatus(a.credential, { ...a.query, idempotencyKey: input.idempotencyKey, status: input.status, items }),
      apply: async (t, tn) => { for (const l of loaded) await setEntity(t, tn, l.level, l.e.id, { status: input.status }); } };
  });
}

export async function rename(db: Database, user: string, workspace: string, data: unknown, deps: AdsDeps, key: string) {
  const input = parse(renameInput, data), idem = parse(z.uuid(), key);
  return run(db, user, workspace, deps, { key: idem, op: "rename", target: input.id }, async (tx, tenant): Promise<Plan<void>> => {
    const e = await target(tx, tenant, input.level, input.id, input.version);
    const ref = remoteRef(e);
    return { op: "rename", key: idem, adAccountId: e.adAccountId, targetLevel: input.level, targetId: e.id, summary: { level: input.level },
      call: (a) => a.provider.rename(a.credential, { ...a.query, idempotencyKey: idem, level: input.level, ref, name: input.name }), apply: (t, tn) => setEntity(t, tn, input.level, e.id, { name: input.name }) };
  });
}

/** Budget or bid change. Needs explicit confirmation, the current version and an idempotency key. */
export async function setBudget(db: Database, user: string, workspace: string, data: unknown, deps: AdsDeps) {
  const input = parse(budgetInput, data);
  return run(db, user, workspace, deps, { key: input.idempotencyKey, op: "budget", target: input.id }, async (tx, tenant): Promise<Plan<void>> => {
    const e = await target(tx, tenant, input.level, input.id, input.version) as Entity & { budgetLevel?: string | null; budgetType?: string | null; endDate?: string | null; budgetAmount?: number | null };
    const ref = remoteRef(e);
    if (e.status === "deleted" || e.status === "archived") throw invalid("STATUS_NOT_ALLOWED");
    if (input.level === "campaign" && e.budgetLevel === "adset" && input.budgetAmount !== undefined) throw invalid("BUDGET_LEVEL");
    if (input.level === "adset" && e.budgetAmount === null && input.budgetAmount !== undefined) throw invalid("BUDGET_LEVEL");
    if (e.budgetType === "lifetime" && !(input.endDate ?? e.endDate)) throw invalid("LIFETIME_NEEDS_END_DATE");
    const set: Record<string, unknown> = {};
    if (input.budgetAmount !== undefined) set.budgetAmount = input.budgetAmount;
    if (input.bidding) set.bidding = input.bidding;
    if (input.endDate) set.endDate = input.endDate;
    return { op: "budget", key: input.idempotencyKey, adAccountId: e.adAccountId, targetLevel: input.level, targetId: e.id,
      summary: { level: input.level, version: e.version, budget: input.budgetAmount ?? "unchanged", bid: input.bidding ? "changed" : "unchanged" },
      call: (a) => a.provider.setBudget(a.credential, { ...a.query, idempotencyKey: input.idempotencyKey, level: input.level, ref, budgetAmount: input.budgetAmount, bidding: input.bidding, endDate: input.endDate }),
      apply: (t, tn) => setEntity(t, tn, input.level, e.id, set) };
  });
}

/** Cancel an ad. History is kept: some networks archive instead of deleting, and the local record keeps the outcome. Irreversible, so it needs confirmation. */
export async function remove(db: Database, user: string, workspace: string, data: unknown, deps: AdsDeps) {
  const input = parse(deleteInput, data);
  return run(db, user, workspace, deps, { key: input.idempotencyKey, op: "delete", target: input.id }, async (tx, tenant): Promise<Plan<{ result: "deleted" | "archived" }>> => {
    const e = await target(tx, tenant, input.level, input.id, input.version);
    if (e.status === "deleted" || e.status === "archived") throw invalid("STATUS_NOT_ALLOWED");
    const ref = remoteRef(e);
    return { op: "delete", key: input.idempotencyKey, adAccountId: e.adAccountId, targetLevel: input.level, targetId: e.id, summary: { level: input.level, version: e.version },
      call: (a) => a.provider.remove(a.credential, { ...a.query, idempotencyKey: input.idempotencyKey, level: input.level, ref }), apply: (t, tn, r) => setEntity(t, tn, input.level, e.id, { status: r.result }) };
  });
}

const lookup = z.object({ adAccountId: z.uuid() });
async function reader<T>(db: Database, user: string, workspace: string, deps: AdsDeps, adAccountId: string, call: (a: Access) => Promise<T>) {
  const access = await withAds(db, user, workspace, deps, async (tx, tenant) => providerAccess(await loadAccount(tx, tenant, adAccountId), deps));
  try { return await call(access); } catch (error) { throw invalid(`PROVIDER_${failureCode(error)}`); }
}
export const listBoostablePosts = (db: Database, user: string, ws: string, adAccountId: string, deps: AdsDeps) =>
  reader(db, user, ws, deps, parse(lookup, { adAccountId }).adAccountId, async a => ({ posts: (await a.provider.listBoostablePosts(a.credential, a.query)).items.map(p => ({ ref: p.ref, platform: p.platform, publishedAt: p.publishedAt?.toISOString() ?? null })) }));
export const listIdentities = (db: Database, user: string, ws: string, adAccountId: string, deps: AdsDeps) =>
  reader(db, user, ws, deps, parse(lookup, { adAccountId }).adAccountId, async a => ({ identities: await a.provider.listIdentities(a.credential, a.query) }));
export const listSharedBudgets = (db: Database, user: string, ws: string, adAccountId: string, deps: AdsDeps) =>
  reader(db, user, ws, deps, parse(lookup, { adAccountId }).adAccountId, async a => ({ sharedBudgets: await a.provider.listSharedBudgets(a.credential, a.query) }));
export const searchTargeting = async (db: Database, user: string, ws: string, adAccountId: string, data: unknown, deps: AdsDeps) => {
  const q = parse(z.object({ kind: z.enum(["interest", "behaviour", "location", "language", "audience"]), query: z.string().trim().min(1).max(80) }).strict(), data);
  return reader(db, user, ws, deps, parse(lookup, { adAccountId }).adAccountId, async a => ({ hits: (await a.provider.searchTargeting(a.credential, { ...a.query, ...q })).slice(0, 50) }));
};
void recordId; void unavailable;
