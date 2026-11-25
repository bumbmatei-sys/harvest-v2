import { deriveRatios, type AdLevel, type AdStatus, type ResultMetric, type ResultMetrics } from "./ads";

// Browser side of the Ads routes. Types mirror the route responses; nothing here talks to a provider, and a metric nobody reported is null ("unavailable"), never zero.
export type AdAccountView = { id: string; connectionId: string; network: string; externalRef: string; name: string; currency: string | null; timezone: string | null; status: string;
  health: Record<string, { state: string; fixUrl?: string | null }>; lastRefusal: { code: string; fixUrl: string | null } | null; healthCheckedAt: string | null; syncedAt: string | null; syncState: string; version: number };
export type TreeAd = { id: string; adSetId: string; campaignId: string; name: string; status: AdStatus; format: string; reviewStatus: string; reviewReason: string | null; deliveryIssue: string | null; sourcePostRef: string | null; version: number };
export type TreeAdSet = { id: string; name: string; status: AdStatus; budgetAmount: number | null; budgetType: "daily" | "lifetime" | null; startDate: string | null; endDate: string | null;
  bidding: { costType: string; unitCost?: number } | null; targeting: Record<string, unknown>; version: number; ads: TreeAd[] };
export type TreeCampaign = { id: string; adAccountId: string; name: string; goal: string; status: AdStatus; budgetAmount: number | null; budgetType: "daily" | "lifetime" | null; budgetLevel: "campaign" | "adset" | null;
  startDate: string | null; endDate: string | null; bidding: { costType: string; unitCost?: number } | null; specialAdCategories: string[]; version: number; adSets: TreeAdSet[] };
export type ResultsRow = { level: AdLevel; entityId: string; day: string; metrics: ResultMetrics };
export type AdsAlert = { id: string; adAccountId: string; kind: string; severity: string; subjectLevel: string | null; subjectId: string | null; state: string; createdAt: string };

/** One table row at any level: the fields the columns need, whatever the level. */
export type Entity = {
  level: AdLevel; id: string; name: string; status: AdStatus; version: number; campaignId: string; adSetId: string | null;
  goal: string | null; budgetAmount: number | null; budgetType: "daily" | "lifetime" | null; budgetOn: "campaign" | "adset" | null; bidding: string | null;
  startDate: string | null; endDate: string | null; format: string | null; reviewStatus: string | null; reviewReason: string | null; deliveryIssue: string | null; sourcePostRef: string | null;
  parentName: string | null; childCount: number;
};
export type Flat = { campaigns: Entity[]; adSets: Entity[]; ads: Entity[] };

const bid = (b: { costType: string; unitCost?: number } | null) => b ? (b.unitCost !== undefined ? `${b.costType}:${b.unitCost}` : b.costType) : null;
export function flatten(campaigns: readonly TreeCampaign[]): Flat {
  const out: Flat = { campaigns: [], adSets: [], ads: [] };
  for (const c of campaigns) {
    out.campaigns.push({ level: "campaign", id: c.id, name: c.name, status: c.status, version: c.version, campaignId: c.id, adSetId: null, goal: c.goal, budgetAmount: c.budgetAmount, budgetType: c.budgetType, budgetOn: c.budgetLevel ?? "campaign",
      bidding: bid(c.bidding), startDate: c.startDate, endDate: c.endDate, format: null, reviewStatus: null, reviewReason: null, deliveryIssue: null, sourcePostRef: null, parentName: null, childCount: c.adSets.length });
    for (const s of c.adSets) {
      out.adSets.push({ level: "adset", id: s.id, name: s.name, status: s.status, version: s.version, campaignId: c.id, adSetId: s.id, goal: c.goal, budgetAmount: s.budgetAmount, budgetType: s.budgetType, budgetOn: "adset",
        bidding: bid(s.bidding), startDate: s.startDate, endDate: s.endDate, format: null, reviewStatus: null, reviewReason: null, deliveryIssue: null, sourcePostRef: null, parentName: c.name, childCount: s.ads.length });
      for (const a of s.ads) out.ads.push({ level: "ad", id: a.id, name: a.name, status: a.status, version: a.version, campaignId: c.id, adSetId: s.id, goal: c.goal, budgetAmount: null, budgetType: null, budgetOn: null, bidding: null,
        startDate: s.startDate, endDate: s.endDate, format: a.format, reviewStatus: a.reviewStatus, reviewReason: a.reviewReason, deliveryIssue: a.deliveryIssue, sourcePostRef: a.sourcePostRef, parentName: s.name, childCount: 0 });
    }
  }
  return out;
}

export type Tab = "campaigns" | "adsets" | "ads";
export const tabLevel: Record<Tab, AdLevel> = { campaigns: "campaign", adsets: "adset", ads: "ad" };
export type Selection = { campaigns: readonly string[]; adsets: readonly string[] };
/**
 * Selecting rows on one level filters the next: ad sets show only those of the selected campaigns, ads only those of the selected ad sets (or, with no ad set selected,
 * of the selected campaigns). No selection means no filter.
 */
export function visibleRows(flat: Flat, tab: Tab, selection: Selection): Entity[] {
  if (tab === "campaigns") return flat.campaigns;
  if (tab === "adsets") return selection.campaigns.length ? flat.adSets.filter((row) => selection.campaigns.includes(row.campaignId)) : flat.adSets;
  if (selection.adsets.length) return flat.ads.filter((row) => row.adSetId && selection.adsets.includes(row.adSetId));
  return selection.campaigns.length ? flat.ads.filter((row) => selection.campaigns.includes(row.campaignId)) : flat.ads;
}
/** A selection that no longer exists (a row left the tree, or its campaign was unselected) is dropped, so a filter never hides everything by accident. */
export function pruneSelection(flat: Flat, selection: Selection): Selection {
  const campaigns = selection.campaigns.filter((id) => flat.campaigns.some((row) => row.id === id));
  const adsets = selection.adsets.filter((id) => flat.adSets.some((row) => row.id === id && (campaigns.length === 0 || campaigns.includes(row.campaignId))));
  return { campaigns, adsets };
}

// ---- results ----
const additive = ["spend", "impressions", "clicks", "results", "conversions", "leads"] as const;
export type Aggregate = { metrics: ResultMetrics; days: number };
/**
 * Per-entity sums over the range. A metric that no day reported stays absent (unavailable). Ratios are recomputed from the sums. Reach is not additive across days, so a row's
 * reach is the average per reporting day, and says so wherever it is shown.
 */
export function aggregate(rows: readonly ResultsRow[]): Map<string, Aggregate> {
  const sums = new Map<string, { metrics: ResultMetrics; reach: number[]; days: Set<string> }>();
  for (const row of rows) {
    const entry = sums.get(row.entityId) ?? { metrics: {}, reach: [], days: new Set<string>() };
    for (const key of additive) { const v = row.metrics[key]; if (v !== undefined) entry.metrics[key] = (entry.metrics[key] ?? 0) + v; }
    if (row.metrics.reach !== undefined) entry.reach.push(row.metrics.reach);
    entry.days.add(row.day); sums.set(row.entityId, entry);
  }
  return new Map([...sums].map(([id, entry]) => {
    const metrics = deriveRatios(entry.metrics);
    if (entry.reach.length) metrics.reach = entry.reach.reduce((a, b) => a + b, 0) / entry.reach.length;
    return [id, { metrics, days: entry.days.size }];
  }));
}
/** Totals over the rows shown: only entities in `ids`. Reach is the average of the per-day totals. */
export function totalsFor(rows: readonly ResultsRow[], ids: ReadonlySet<string>): ResultMetrics {
  const mine = rows.filter((row) => ids.has(row.entityId)), totals: ResultMetrics = {};
  for (const key of additive) { const seen = mine.filter((row) => row.metrics[key] !== undefined); if (seen.length) totals[key] = seen.reduce((sum, row) => sum + (row.metrics[key] as number), 0); }
  const perDay = new Map<string, number>();
  for (const row of mine) if (row.metrics.reach !== undefined) perDay.set(row.day, (perDay.get(row.day) ?? 0) + row.metrics.reach);
  const ratios = deriveRatios(totals);
  if (perDay.size) ratios.reach = [...perDay.values()].reduce((a, b) => a + b, 0) / perDay.size;
  return ratios;
}
export type DayPoint = { day: string; value: number | null; availability: "available" | "unavailable" };
/** One value per day of the range for a sparkline; a day nobody reported is a gap, never zero. */
export function daily(rows: readonly ResultsRow[], ids: ReadonlySet<string>, metric: ResultMetric, days: readonly string[]): DayPoint[] {
  const by = new Map<string, ResultMetrics>();
  for (const day of days) by.set(day, {});
  for (const row of rows) {
    if (!ids.has(row.entityId)) continue;
    const bucket = by.get(row.day); if (!bucket) continue;
    for (const key of [...additive, "reach"] as const) { const v = row.metrics[key]; if (v !== undefined) bucket[key] = (bucket[key] ?? 0) + v; }
  }
  return days.map((day) => { const value = deriveRatios(by.get(day) ?? {})[metric]; return value === undefined ? { day, value: null, availability: "unavailable" as const } : { day, value, availability: "available" as const }; });
}
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []; const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// ---- columns ----
export const columnGroups = ["performance", "delivery", "engagement", "custom"] as const;
export type ColumnGroup = typeof columnGroups[number];
export const columnIds = ["delivery", "budget", "results", "costPerResult", "reach", "impressions", "spend", "ends", "goal", "bidding", "starts", "clicks", "ctr", "cpc", "cpm", "format", "review"] as const;
export type ColumnId = typeof columnIds[number];
export const columnPresets: Record<Exclude<ColumnGroup, "custom">, readonly ColumnId[]> = {
  performance: ["delivery", "budget", "results", "costPerResult", "reach", "impressions", "spend", "ends"],
  delivery: ["delivery", "budget", "goal", "bidding", "starts", "ends", "review"],
  engagement: ["delivery", "impressions", "reach", "clicks", "ctr", "cpc", "cpm", "spend"],
};
export function columnsFor(group: ColumnGroup, custom: readonly ColumnId[]): readonly ColumnId[] { return group === "custom" ? (custom.length ? custom : columnPresets.performance) : columnPresets[group]; }
/** Which columns make sense at a level (an ad has no budget; a campaign has no review state). */
export function appliesTo(column: ColumnId, level: AdLevel) {
  if (column === "budget" || column === "bidding") return level !== "ad";
  if (column === "review" || column === "format") return level === "ad";
  if (column === "goal") return level === "campaign";
  return true;
}

export type DeliveryKey = "off" | "active" | "completed" | "inReview" | "rejected" | "issue" | "notDelivering" | "archived";
/** What a person sees in the Delivery column. An ad's review result and delivery issue come before its on/off state; a finished end date reads Completed. */
export function deliveryOf(row: Entity, today: string): DeliveryKey {
  if (row.status === "archived" || row.status === "deleted") return "archived";
  if (row.level === "ad") {
    if (row.reviewStatus === "rejected") return "rejected";
    if (row.reviewStatus === "in_review") return "inReview";
    if (row.deliveryIssue) return "issue";
  }
  if (row.endDate && row.endDate < today) return "completed";
  return row.status === "active" ? "active" : "off";
}
export const statusSwitchable = (row: Entity) => row.status === "active" || row.status === "paused";

/** Rows whose switch change is sendable in one bulk call (max 50, active or paused only). */
export function bulkItems(rows: readonly Entity[]) { return rows.filter(statusSwitchable).map((row) => ({ level: row.level, id: row.id, version: row.version })); }
