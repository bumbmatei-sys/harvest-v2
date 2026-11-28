import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../db/client";
import { adsAccounts, adsAds, adsAdSets, adsAlerts, adsAudiences, adsCampaigns, adsConversionDestinations, adsLeadForms, adsLeads, adsResults, socialConnections } from "../../db/schema";
import { attributionModels, deriveRatios, healthChecks, projectResults, type AdLevel } from "../../lib/ads/ads";
import { z } from "zod";
import { audit, failureCode, invalid, loadAccount, parse, providerAccess, providerFailure, recordId, unavailable, withAds, type AccountContext } from "./access";
import type { RemoteAudience, RemoteCampaign, RemoteConversionDestination, RemoteHealth, RemoteLeadForm } from "./contract";
import { AdsProviderError } from "./port";
import type { AdsDeps } from "./registry";

const MAX_TREE_PAGES = 20;
const jsonLimited = (value: unknown, max = 16_000) => { const v = value && typeof value === "object" ? value as Record<string, unknown> : {}; return JSON.stringify(v).length <= max ? v : {}; };

export const accountView = (row: typeof adsAccounts.$inferSelect) => ({
  id: row.id, connectionId: row.connectionId, network: row.network, externalRef: row.externalRef, name: row.name, currency: row.currency, timezone: row.timezone, status: row.status,
  health: row.health, lastRefusal: row.lastRefusal, healthCheckedAt: row.healthCheckedAt?.toISOString() ?? null, syncedAt: row.syncedAt?.toISOString() ?? null, syncState: row.syncState, version: row.version,
});

export async function listAdAccounts(db: Database, user: string, workspace: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => ({ accounts: (await tx.select().from(adsAccounts).where(eq(adsAccounts.tenantId, tenant)).orderBy(asc(adsAccounts.name), asc(adsAccounts.id))).map(accountView) }));
}

/** Reads the ministry's own ad accounts reachable through one linked social connection and records them. No payment detail is read or kept. */
export async function linkAdAccounts(db: Database, user: string, workspace: string, data: unknown, deps: AdsDeps) {
  const { connectionId } = parse(z.object({ connectionId: z.uuid() }).strict(), data);
  const loaded = await withAds(db, user, workspace, deps, async (tx, tenant) => {
    const [connection] = await tx.select().from(socialConnections).where(and(eq(socialConnections.tenantId, tenant), eq(socialConnections.id, connectionId), eq(socialConnections.status, "active")));
    if (!connection) throw unavailable();
    return { tenant, connection };
  });
  const ctx = { connection: loaded.connection } as AccountContext;
  let remote;
  try {
    const { provider, credential } = providerAccess({ ...ctx, account: { externalRef: "" } as never }, deps);
    remote = await provider.listAdAccounts(credential, loaded.connection.externalAccountRef);
  } catch (error) { providerFailure(error); }
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const rows = [];
    for (const a of remote.slice(0, 100)) {
      const values = { tenantId: tenant, connectionId, network: a.network, externalRef: a.ref, name: a.name.slice(0, 200) || a.ref, currency: a.currency, timezone: a.timezone, status: a.status, createdBy: user };
      const [row] = await tx.insert(adsAccounts).values(values).onConflictDoUpdate({ target: [adsAccounts.tenantId, adsAccounts.connectionId, adsAccounts.externalRef],
        set: { name: values.name, currency: a.currency, timezone: a.timezone, status: a.status, version: sql`${adsAccounts.version} + 1`, updatedAt: sql`now()` } }).returning();
      rows.push(row);
    }
    await audit(tx, tenant, user, "accounts_linked", connectionId, { count: String(rows.length) });
    return { accounts: rows.map(accountView) };
  });
}

async function prepare(db: Database, user: string, workspace: string, adAccountId: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const ctx = await loadAccount(tx, tenant, adAccountId);
    return { tenant, ctx, access: providerAccess(ctx, deps) };
  });
}

/** Health check: every named check is stored; a check the provider did not answer is "unknown", never "ok". */
export async function checkAccountHealth(db: Database, user: string, workspace: string, adAccountId: string, deps: AdsDeps) {
  const { tenant, ctx, access } = await prepare(db, user, workspace, adAccountId, deps);
  let health: RemoteHealth | null = null, code: string | null = null;
  try { health = await access.provider.getAdAccountHealth(access.credential, access.query); } catch (error) { code = failureCode(error); }
  const view = await withAds(db, user, workspace, deps, async (tx) => {
    const id = ctx.account.id;
    if (!health) {
      await raiseAlert(tx, tenant, id, code === "AUTH" ? "connection_lost" : "sync_failed", code === "AUTH" ? "critical" : "warning", code === "AUTH" ? "connection" : "health");
      await tx.update(adsAccounts).set({ syncState: "failing", healthCheckedAt: sql`now()`, updatedAt: sql`now()` }).where(and(eq(adsAccounts.tenantId, tenant), eq(adsAccounts.id, id)));
      return null;
    }
    const checks: Record<string, { state: string; fixUrl?: string | null }> = {};
    for (const name of healthChecks) { const c = health.checks[name]; checks[name] = c ? { state: c.state, fixUrl: c.fixUrl ?? null } : { state: "unknown" }; }
    const [row] = await tx.update(adsAccounts).set({ health: checks, lastRefusal: health.lastRefusal, status: health.status, healthCheckedAt: sql`now()`, version: sql`${adsAccounts.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(adsAccounts.tenantId, tenant), eq(adsAccounts.id, id))).returning();
    for (const [key, kind, name] of [["payment_method", "payment_problem", "payment"], ["account_status", "account_restricted", "account"]] as const) {
      if (checks[key].state === "failing") await raiseAlert(tx, tenant, id, kind, "critical", name);
      else await resolveAlert(tx, tenant, id, name);
    }
    if (health.status !== "active" && health.status !== "unknown") await raiseAlert(tx, tenant, id, "account_restricted", "critical", `account:${health.status}`);
    return { account: accountView(row), newestPixelEventAt: health.newestPixelEventAt?.toISOString() ?? null };
  });
  // The failure alert is committed before the caller sees the refusal.
  if (!view) throw invalid(`PROVIDER_${code}`);
  return view;
}

export async function raiseAlert(tx: Transaction, tenant: string, adAccountId: string, kind: typeof adsAlerts.$inferInsert["kind"], severity: "info" | "warning" | "critical", dedupeKey: string, subject?: { level: AdLevel; id: string }) {
  await tx.insert(adsAlerts).values({ tenantId: tenant, adAccountId, kind, severity, dedupeKey, subjectLevel: subject?.level, subjectId: subject?.id }).onConflictDoNothing();
}
export async function resolveAlert(tx: Transaction, tenant: string, adAccountId: string, dedupeKey: string) {
  await tx.update(adsAlerts).set({ state: "resolved", resolvedAt: sql`now()` }).where(and(eq(adsAlerts.tenantId, tenant), eq(adsAlerts.adAccountId, adAccountId), eq(adsAlerts.dedupeKey, dedupeKey), eq(adsAlerts.state, "open")));
}

async function applyTree(tx: Transaction, tenant: string, adAccountId: string, campaigns: RemoteCampaign[]) {
  for (const c of campaigns) {
    const [camp] = await tx.insert(adsCampaigns).values({ tenantId: tenant, adAccountId, externalRef: c.ref, name: c.name.slice(0, 200) || c.ref, goal: c.goal, status: c.status, budgetAmount: c.budgetAmount, budgetType: c.budgetType,
      budgetLevel: c.budgetLevel, sharedBudgetRef: c.sharedBudgetRef, startDate: c.startDate, endDate: c.endDate, bidding: c.bidding, specialAdCategories: c.specialAdCategories, attributionModel: c.attributionModel, syncedAt: sql`now()` })
      .onConflictDoUpdate({ target: [adsCampaigns.tenantId, adsCampaigns.adAccountId, adsCampaigns.externalRef], set: { name: c.name.slice(0, 200) || c.ref, goal: c.goal, status: c.status, budgetAmount: c.budgetAmount, budgetType: c.budgetType,
        budgetLevel: c.budgetLevel, sharedBudgetRef: c.sharedBudgetRef, startDate: c.startDate, endDate: c.endDate, bidding: c.bidding, specialAdCategories: c.specialAdCategories, attributionModel: c.attributionModel,
        syncedAt: sql`now()`, updatedAt: sql`now()`, version: sql`${adsCampaigns.version} + 1` } }).returning();
    for (const s of c.adSets) {
      const [set] = await tx.insert(adsAdSets).values({ tenantId: tenant, adAccountId, campaignId: camp.id, externalRef: s.ref, name: s.name.slice(0, 200) || s.ref, status: s.status, budgetAmount: s.budgetAmount, budgetType: s.budgetType,
        startDate: s.startDate, endDate: s.endDate, bidding: s.bidding, targeting: jsonLimited(s.targeting), syncedAt: sql`now()` })
        .onConflictDoUpdate({ target: [adsAdSets.tenantId, adsAdSets.adAccountId, adsAdSets.externalRef], set: { name: s.name.slice(0, 200) || s.ref, status: s.status, budgetAmount: s.budgetAmount, budgetType: s.budgetType, startDate: s.startDate,
          endDate: s.endDate, bidding: s.bidding, targeting: jsonLimited(s.targeting), syncedAt: sql`now()`, updatedAt: sql`now()`, version: sql`${adsAdSets.version} + 1` } }).returning();
      for (const a of s.ads) {
        const values = { tenantId: tenant, adAccountId, campaignId: camp.id, adSetId: set.id, externalRef: a.ref, name: a.name.slice(0, 200) || a.ref, status: a.status, format: a.format, creativeRef: a.creativeRef, sourcePostRef: a.sourcePostRef,
          reviewStatus: a.review, reviewReason: a.reviewReason?.slice(0, 500) ?? null, deliveryIssue: a.deliveryIssue?.slice(0, 500) ?? null, syncedAt: sql`now()` };
        const [ad] = await tx.insert(adsAds).values(values).onConflictDoUpdate({ target: [adsAds.tenantId, adsAds.adAccountId, adsAds.externalRef], set: { name: values.name, status: a.status, format: a.format, creativeRef: a.creativeRef,
          sourcePostRef: a.sourcePostRef, reviewStatus: a.review, reviewReason: values.reviewReason, deliveryIssue: values.deliveryIssue, syncedAt: sql`now()`, updatedAt: sql`now()`, version: sql`${adsAds.version} + 1` } }).returning();
        const base = `ad:${ad.id}`;
        if (a.review === "rejected") await raiseAlert(tx, tenant, adAccountId, "ad_rejected", "warning", `${base}:rejected`, { level: "ad", id: ad.id }); else await resolveAlert(tx, tenant, adAccountId, `${base}:rejected`);
        if (a.deliveryIssue) await raiseAlert(tx, tenant, adAccountId, a.deliveryIssue === "budget_capped" ? "budget_capped" : "delivery_issue", "warning", `${base}:delivery`, { level: "ad", id: ad.id });
        else await resolveAlert(tx, tenant, adAccountId, `${base}:delivery`);
      }
    }
  }
}

/** Reads the whole campaign tree, audiences, lead forms and conversion destinations for one ad account into the metadata mirror. Read only toward the provider. */
export async function syncAdAccount(db: Database, user: string, workspace: string, adAccountId: string, deps: AdsDeps) {
  const { tenant, ctx, access } = await prepare(db, user, workspace, adAccountId, deps);
  const { provider, credential, query } = access;
  const campaigns: RemoteCampaign[] = [];
  let failure: string | null = null, audiences: RemoteAudience[] | undefined, forms: RemoteLeadForm[] | undefined, destinations: RemoteConversionDestination[] | undefined;
  try {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TREE_PAGES; page++) {
      const result = await provider.listCampaignTree(credential, { ...query, cursor });
      campaigns.push(...result.items);
      if (!result.nextCursor) break; cursor = result.nextCursor;
    }
    [audiences, forms, destinations] = await Promise.all([provider.listAudiences(credential, query), provider.listLeadForms(credential, query), provider.listConversionDestinations(credential, query)]);
  } catch (error) { failure = failureCode(error); }
  return withAds(db, user, workspace, deps, async (tx) => {
    const id = ctx.account.id;
    if (failure || !audiences || !forms || !destinations) {
      await tx.update(adsAccounts).set({ syncState: failure === "RATE_LIMITED" ? "delayed" : "failing", updatedAt: sql`now()` }).where(and(eq(adsAccounts.tenantId, tenant), eq(adsAccounts.id, id)));
      await raiseAlert(tx, tenant, id, failure === "AUTH" ? "connection_lost" : "sync_failed", failure === "AUTH" ? "critical" : "warning", failure === "AUTH" ? "connection" : "sync");
      return { synced: false, code: failure };
    }
    await applyTree(tx, tenant, id, campaigns);
    for (const audience of audiences.slice(0, 500)) {
      const fields = { kind: audience.kind, name: audience.name.slice(0, 200) || audience.ref, sizeEstimate: audience.sizeEstimate, syncedAt: sql`now()` };
      const [inserted] = await tx.insert(adsAudiences).values({
        tenantId: tenant, adAccountId: id, externalRef: audience.ref, ...fields,
        spec: audience.spec && JSON.stringify(audience.spec).length <= 16_000 ? audience.spec : null,
      }).onConflictDoNothing({ target: [adsAudiences.tenantId, adsAudiences.adAccountId, adsAudiences.externalRef] })
        .returning({ id: adsAudiences.id });
      if (inserted) continue;
      // A plain UPDATE can skip rows outside the collaborator's policy. An upsert raises before its filter can skip them.
      await tx.update(adsAudiences).set(fields).where(and(eq(adsAudiences.tenantId, tenant),
        eq(adsAudiences.adAccountId, id), eq(adsAudiences.externalRef, audience.ref)));
    }
    for (const f of forms.slice(0, 200)) await tx.insert(adsLeadForms).values({ tenantId: tenant, adAccountId: id, externalRef: f.ref, name: f.name.slice(0, 120) || f.ref, status: f.status, consentText: f.consentText.slice(0, 1000) || "-", privacyUrl: "", questions: f.questions.slice(0, 15) })
      .onConflictDoUpdate({ target: [adsLeadForms.tenantId, adsLeadForms.adAccountId, adsLeadForms.externalRef], set: { name: f.name.slice(0, 120) || f.ref, status: f.status, questions: f.questions.slice(0, 15) } });
    for (const d of destinations.slice(0, 100)) await tx.insert(adsConversionDestinations).values({ tenantId: tenant, adAccountId: id, externalRef: d.ref, kind: d.kind, name: d.name.slice(0, 200) || d.ref, lastEventAt: d.lastEventAt, status: d.status })
      .onConflictDoUpdate({ target: [adsConversionDestinations.tenantId, adsConversionDestinations.adAccountId, adsConversionDestinations.externalRef], set: { name: d.name.slice(0, 200) || d.ref, lastEventAt: d.lastEventAt, status: d.status } });
    await tx.update(adsAccounts).set({ syncedAt: sql`now()`, syncState: "ready", updatedAt: sql`now()` }).where(and(eq(adsAccounts.tenantId, tenant), eq(adsAccounts.id, id)));
    await resolveAlert(tx, tenant, id, "sync"); await resolveAlert(tx, tenant, id, "connection");
    await audit(tx, tenant, user, "account_sync", id, { campaigns: String(campaigns.length) });
    return { synced: true, code: null, campaigns: campaigns.length };
  });
}

export const resultsSyncInput = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), attributionModel: z.enum(attributionModels).default("default") }).strict();
/**
 * Daily results sync. Newest value per day: a row replaces an earlier capture of the same (entity, day, attribution model) and an older capture never overwrites a newer one.
 * Counts only are stored; ratios are recomputed from the counts. A metric the provider did not report stays absent (unavailable, never zero).
 */
export async function syncResults(db: Database, user: string, workspace: string, adAccountId: string, data: unknown, deps: AdsDeps, capturedAt = deps.now()) {
  const input = parse(resultsSyncInput, data);
  const days = (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86_400_000 + 1;
  if (!(days >= 1 && days <= 90)) throw invalid("ADS_INVALID_RANGE");
  const { tenant, ctx, access } = await prepare(db, user, workspace, adAccountId, deps);
  const levels = ["campaign", "adset", "ad"] as const, rows: { level: AdLevel; ref: string; day: string; metrics: Record<string, number> }[] = [];
  let partial = false;
  try {
    for (const level of levels) {
      const r = await access.provider.readResults(access.credential, { ...access.query, level, from: input.from, to: input.to, attributionModel: input.attributionModel });
      partial ||= r.partial; rows.push(...r.rows.slice(0, 20_000));
    }
  } catch (error) { if (error instanceof AdsProviderError) throw invalid(`PROVIDER_${error.code}`); throw error; }
  return withAds(db, user, workspace, deps, async (tx) => {
    let written = 0;
    for (const level of levels) {
      const table = { campaign: adsCampaigns, adset: adsAdSets, ad: adsAds }[level] as typeof adsCampaigns;
      const entities = await tx.select({ id: table.id, ref: table.externalRef }).from(table).where(and(eq(table.tenantId, tenant), eq(table.adAccountId, ctx.account.id)));
      const byRef = new Map(entities.map(e => [e.ref, e.id]));
      for (const row of rows.filter(r => r.level === level)) {
        const entityId = byRef.get(row.ref);
        if (!entityId || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)) continue;
        const metrics = deriveRatios(projectResults(row.metrics));
        const res = await tx.insert(adsResults).values({ tenantId: tenant, adAccountId: ctx.account.id, level, entityId, day: row.day, attributionModel: input.attributionModel, capturedAt, metrics })
          .onConflictDoUpdate({ target: [adsResults.tenantId, adsResults.level, adsResults.entityId, adsResults.day, adsResults.attributionModel], set: { metrics, capturedAt },
            setWhere: sql`${adsResults.capturedAt} <= ${capturedAt.toISOString()}::timestamptz` }).returning({ day: adsResults.day });
        written += res.length;
      }
    }
    await detectSpendWithoutResults(tx, tenant, ctx.account.id, input.to);
    return { written, partial };
  });
}

/** "Needs attention": spend in the last three days with zero reported results. Missing results are unavailable, not zero, so they never raise this. */
async function detectSpendWithoutResults(tx: Transaction, tenant: string, adAccountId: string, to: string) {
  const { rows } = await tx.execute<{ entity_id: string; spend: number; results: number | null }>(sql`
    select entity_id, sum((metrics->>'spend')::numeric)::float8 as spend, sum((metrics->>'results')::numeric)::float8 as results
    from ads_results where tenant_id = ${tenant} and ad_account_id = ${adAccountId} and level = 'campaign' and day between (${to}::date - 2) and ${to}::date
    group by entity_id`);
  for (const r of rows) {
    const key = `spend_no_results:${r.entity_id}`;
    if (r.spend > 0 && r.results !== null && r.results === 0) await raiseAlert(tx, tenant, adAccountId, "spend_without_results", "warning", key, { level: "campaign", id: r.entity_id });
    else await resolveAlert(tx, tenant, adAccountId, key);
  }
}

export async function listAlerts(db: Database, user: string, workspace: string, deps: AdsDeps, state: "open" | "resolved" | "dismissed" = "open") {
  return withAds(db, user, workspace, deps, async (tx, tenant) => ({ alerts: (await tx.select().from(adsAlerts).where(and(eq(adsAlerts.tenantId, tenant), eq(adsAlerts.state, state))).orderBy(desc(adsAlerts.createdAt)).limit(200)).map(a => ({
    id: a.id, adAccountId: a.adAccountId, kind: a.kind, severity: a.severity, subjectLevel: a.subjectLevel, subjectId: a.subjectId, state: a.state, createdAt: a.createdAt.toISOString() })) }));
}
export async function dismissAlert(db: Database, user: string, workspace: string, alertId: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const [row] = await tx.update(adsAlerts).set({ state: "dismissed", resolvedAt: sql`now()` }).where(and(eq(adsAlerts.tenantId, tenant), eq(adsAlerts.id, recordId(alertId)), eq(adsAlerts.state, "open"))).returning({ id: adsAlerts.id });
    if (!row) throw unavailable();
    await audit(tx, tenant, user, "alert_dismiss", row.id);
    return { dismissed: true };
  });
}
export async function listAudiences(db: Database, user: string, workspace: string, adAccountId: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => ({ audiences: await tx.select({ id: adsAudiences.id, kind: adsAudiences.kind, name: adsAudiences.name, sizeEstimate: adsAudiences.sizeEstimate, status: adsAudiences.status })
    .from(adsAudiences).where(and(eq(adsAudiences.tenantId, tenant), eq(adsAudiences.adAccountId, recordId(adAccountId)))).orderBy(asc(adsAudiences.name)) }));
}
export async function listConversionDestinations(db: Database, user: string, workspace: string, adAccountId: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => ({ destinations: await tx.select().from(adsConversionDestinations).where(and(eq(adsConversionDestinations.tenantId, tenant), eq(adsConversionDestinations.adAccountId, recordId(adAccountId)))) }));
}
void adsLeads;
