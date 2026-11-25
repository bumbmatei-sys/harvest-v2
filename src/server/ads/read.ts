import { and, asc, between, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { adsAds, adsAdSets, adsCampaigns, adsResults } from "../../db/schema";
import { adLevels, attributionModels, deriveRatios, isoDay, resultMetrics, type ResultMetrics } from "../../lib/ads/ads";
import { invalid, parse, recordId, withAds } from "./access";
import type { AdsDeps } from "./registry";

export async function readTree(db: Database, user: string, workspace: string, adAccountId: string | null, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const acct = adAccountId ? recordId(adAccountId) : null;
    const [campaigns, adSets, ads] = await Promise.all([
      tx.select().from(adsCampaigns).where(and(eq(adsCampaigns.tenantId, tenant), acct ? eq(adsCampaigns.adAccountId, acct) : undefined)).orderBy(asc(adsCampaigns.name), asc(adsCampaigns.id)).limit(500),
      tx.select().from(adsAdSets).where(and(eq(adsAdSets.tenantId, tenant), acct ? eq(adsAdSets.adAccountId, acct) : undefined)).orderBy(asc(adsAdSets.name), asc(adsAdSets.id)).limit(2000),
      tx.select({ id: adsAds.id, adSetId: adsAds.adSetId, campaignId: adsAds.campaignId, name: adsAds.name, status: adsAds.status, format: adsAds.format, reviewStatus: adsAds.reviewStatus, reviewReason: adsAds.reviewReason,
        deliveryIssue: adsAds.deliveryIssue, sourcePostRef: adsAds.sourcePostRef, version: adsAds.version }).from(adsAds).where(and(eq(adsAds.tenantId, tenant), acct ? eq(adsAds.adAccountId, acct) : undefined)).orderBy(asc(adsAds.name), asc(adsAds.id)).limit(5000),
    ]);
    return { campaigns: campaigns.map(c => ({ id: c.id, adAccountId: c.adAccountId, name: c.name, goal: c.goal, status: c.status, budgetAmount: c.budgetAmount, budgetType: c.budgetType, budgetLevel: c.budgetLevel, sharedBudgetRef: c.sharedBudgetRef,
      startDate: c.startDate, endDate: c.endDate, bidding: c.bidding, specialAdCategories: c.specialAdCategories, attributionModel: c.attributionModel, version: c.version,
      adSets: adSets.filter(s => s.campaignId === c.id).map(s => ({ id: s.id, name: s.name, status: s.status, budgetAmount: s.budgetAmount, budgetType: s.budgetType, startDate: s.startDate, endDate: s.endDate, bidding: s.bidding, targeting: s.targeting,
        version: s.version, ads: ads.filter(a => a.adSetId === s.id) })) })) };
  });
}

const resultsQuery = z.object({ adAccountId: z.uuid(), level: z.enum(adLevels), from: isoDay, to: isoDay, attributionModel: z.enum(attributionModels).default("default"), entityId: z.uuid().optional() }).strict();
const additive = ["spend", "impressions", "clicks", "results", "conversions", "leads"] as const;
/** Results per entity and day, with totals. A metric that was never reported is `unavailable` (null), never zero; a total over a partly reported range is `partial`. */
export async function readResults(db: Database, user: string, workspace: string, query: unknown, deps: AdsDeps) {
  const q = parse(resultsQuery, query);
  const days = (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000 + 1;
  if (!(days >= 1 && days <= 366)) throw invalid("ADS_INVALID_RANGE");
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const rows = await tx.select().from(adsResults).where(and(eq(adsResults.tenantId, tenant), eq(adsResults.adAccountId, q.adAccountId), eq(adsResults.level, q.level), eq(adsResults.attributionModel, q.attributionModel),
      between(adsResults.day, q.from, q.to), q.entityId ? eq(adsResults.entityId, q.entityId) : undefined)).orderBy(asc(adsResults.day), asc(adsResults.entityId)).limit(12_000);
    const totals: ResultMetrics = {}, partial = new Set<string>();
    for (const metric of additive) {
      const reported = rows.filter(r => r.metrics[metric] !== undefined);
      if (!reported.length) continue;
      totals[metric] = reported.reduce((sum, r) => sum + (r.metrics[metric] as number), 0);
      if (reported.length < rows.length) partial.add(metric);
    }
    const readings = Object.fromEntries(resultMetrics.map(m => {
      const v = deriveRatios(totals)[m];
      // Reach is not additive across days or entities, so it is never totalled.
      return [m, m === "reach" || v === undefined ? { value: null, availability: "unavailable" } : { value: v, availability: partial.size && (m === "ctr" || m === "cpc" || m === "cpm" || m === "costPerResult" || partial.has(m)) ? "partial" : "available" }];
    }));
    return { rows: rows.map(r => ({ level: r.level, entityId: r.entityId, day: r.day, capturedAt: r.capturedAt.toISOString(), metrics: r.metrics })), totals: readings, truncated: rows.length >= 12_000 };
  });
}
