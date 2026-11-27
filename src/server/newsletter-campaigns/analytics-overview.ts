import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import type { Transaction } from "../../db/client";
import { newsletterCampaigns, newsletterSettings } from "../../db/schema";
import { audienceGrowth, eachDay, hideSmall, periodRange, type SnapshotRow, type AnalyticsOverview, type AnalyticsPeriod, type CampaignAnalytics, type CampaignFigures, type ClickFigures, type Counts } from "../../lib/newsletter-analytics";
import { audienceOverview } from "../newsletter-audience";
import { id as idOf, unavailable, withNewsletter } from "./access";
import { analyticsIn } from "./analytics";

const maxCampaigns = 50;
type ClickReport = { total: number | null; days: { day: string; clicks: number | null }[]; campaigns: { id: string; clicks: number | null }[]; links: { url: string; clicks: number }[] };

/** Aggregate link clicks from the definer, which withholds every group under 5; nothing about who clicked exists in its result. */
async function clicksIn(tx: Transaction, tenant: string, range: { from: string; until: string }, campaign: string | null) {
  const { rows: [row] } = await tx.execute<{ report: ClickReport }>(sql`
    select public.newsletter_click_report(${tenant}::uuid,${campaign}::uuid,${range.from}::date,${range.until}::date) as report`);
  const [setting] = await tx.select({ on: newsletterSettings.clickTracking }).from(newsletterSettings).where(eq(newsletterSettings.tenantId, tenant));
  const toNumber = (value: number | string | null) => value === null ? null : Number(value);
  return { counting: setting?.on ?? false, total: toNumber(row.report.total),
    days: row.report.days.map((day) => ({ day: day.day, clicks: toNumber(day.clicks) })),
    campaigns: new Map(row.report.campaigns.map((item) => [item.id, toNumber(item.clicks)])),
    links: row.report.links.map((link) => ({ url: link.url, clicks: Number(link.clicks) })) };
}
const clickFigures = (report: Awaited<ReturnType<typeof clicksIn>>, days: string[]): ClickFigures => {
  const byDay = new Map(report.days.map((day) => [day.day, day.clicks]));
  return { counting: report.counting, total: report.total, days: days.map((day) => ({ day, clicks: byDay.has(day) ? byDay.get(day)! : 0 })), links: report.links };
};
type Report = Awaited<ReturnType<typeof analyticsIn>>;
type Shaped = Extract<Report["totals"], { visibility: "visible" }>;

/** Delivery records to the figures the screen shows. "Sent" is what the provider accepted; a count not yet reported is 0, not an estimate. */
function counts(shaped: Report["totals"]): Counts | null {
  if (shaped.visibility !== "visible") return null;
  const visible = shaped as Shaped, count = (metric: { count: number | null }) => metric.count ?? 0;
  return { sent: count(visible.providerAccepted), delivered: count(visible.outcomes.delivered), bounced: count(visible.outcomes.bounced),
    complained: count(visible.outcomes.complained), unsubscribed: count(visible.outcomes.unsubscribed) };
}

/**
 * Aggregate newsletter statistics for the last 7, 30 or 90 UTC days: totals, a daily series and a per-campaign table. Owners and admins only
 * (`newsletter:analytics`). No recipient is ever listed; small cohorts come back as null. The audience block reuses the Audience status counts.
 */
export async function newsletterAnalyticsOverview(db: Database, actor: string, workspace: string, period: AnalyticsPeriod, now = new Date()): Promise<AnalyticsOverview> {
  const range = periodRange(period, now);
  const report = await withNewsletter(db, actor, workspace, "newsletter:analytics", async (tx, tenant) => {
    const overall = await analyticsIn(tx, tenant, range, null);
    const clicks = await clicksIn(tx, tenant, range, null);
    const candidates = await tx.select({ id: newsletterCampaigns.id, name: newsletterCampaigns.name, state: newsletterCampaigns.state })
      .from(newsletterCampaigns).where(and(eq(newsletterCampaigns.tenantId, tenant), inArray(newsletterCampaigns.state, ["sending", "sent", "partial", "failed", "cancelled"])))
      .orderBy(sql`${newsletterCampaigns.frozenAt} desc nulls last`, desc(newsletterCampaigns.id)).limit(maxCampaigns + 1);
    const rows: CampaignFigures[] = [];
    for (const campaign of candidates.slice(0, maxCampaigns)) {
      const own = await analyticsIn(tx, tenant, range, campaign.id);
      if (own.days.length || clicks.campaigns.has(campaign.id)) rows.push({ id: campaign.id, name: campaign.name, state: campaign.state, counts: own.days.length ? counts(own.totals) : { sent: 0, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0 },
        clicks: clicks.campaigns.has(campaign.id) ? clicks.campaigns.get(campaign.id)! : 0 });
    }
    const snapshots = await tx.execute<SnapshotRow>(sql`
      select * from public.newsletter_audience_growth(${tenant}::uuid,${range.from}::date,${range.until}::date)`);
    return { overall, rows, clicks, truncated: candidates.length > maxCampaigns, snapshots: snapshots.rows };
  });
  const byDay = new Map(report.overall.days.map((day) => [day.day, day]));
  const days = eachDay(range).map((day) => {
    const found = byDay.get(day);
    return { day, counts: found ? counts(found as Report["totals"]) : { sent: 0, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0 } };
  });
  const status = (await audienceOverview(db, actor, workspace)).counts;
  return { period, range, generatedAt: now.toISOString(), totals: counts(report.overall.totals), days, campaigns: report.rows, campaignsTruncated: report.truncated,
    audience: { subscribed: hideSmall(status.subscribed), unsubscribed: hideSmall(status.unsubscribed), suppressed: hideSmall(status.suppressed) },
    clicks: clickFigures(report.clicks, eachDay(range)),
    growth: audienceGrowth(range, report.snapshots) };
}

type Outcomes = { withheld: boolean; archived: boolean; days: { day: string; metric: keyof Counts; count: number }[] };
const sentStates = ["sending", "sent", "partial", "failed", "cancelled"];

/**
 * One campaign's aggregate figures for the 90 days the delivery records are kept: totals, a daily series from the first day with records, and the delivery
 * status breakdown. Drafts and campaigns not sent report `sent: false`. Owners and admins only; a small cohort is null.
 */
export async function newsletterCampaignAnalytics(db: Database, actor: string, workspace: string, campaignId: string, now = new Date()): Promise<CampaignAnalytics> {
  const range = periodRange(90, now);
  const report = await withNewsletter(db, actor, workspace, "newsletter:analytics", async (tx, tenant) => {
    const [campaign] = await tx.select({ id: newsletterCampaigns.id, name: newsletterCampaigns.name, state: newsletterCampaigns.state })
      .from(newsletterCampaigns).where(and(eq(newsletterCampaigns.id, idOf(campaignId)), eq(newsletterCampaigns.tenantId, tenant)));
    if (!campaign) throw unavailable();
    if (!sentStates.includes(campaign.state)) return { campaign, report: null, outcomes: null, clicks: null };
    const outcomes = await tx.execute<{ result: Outcomes }>(sql`
      select public.newsletter_outcome_days(${tenant}::uuid,${campaign.id}::uuid,${range.from}::date,${range.until}::date) as result`);
    return { campaign, report: await analyticsIn(tx, tenant, range, campaign.id), outcomes: outcomes.rows[0].result, clicks: await clicksIn(tx, tenant, range, campaign.id) };
  });
  const { campaign, report: data, outcomes } = report;
  if (!data || !outcomes) return { campaign, sent: false, range, generatedAt: now.toISOString(), totals: null, days: [], outcomeDays: [], outcomesArchived: false, status: null, clicks: null };
  const byDay = new Map(data.days.map((day) => [day.day, day]));
  const all = eachDay(range), firstIndex = Math.max(0, all.findIndex((day) => byDay.has(day)));
  const days = all.slice(Math.min(firstIndex, all.length - 7)).map((day) => {
    const found = byDay.get(day);
    return { day, counts: found ? counts(found as Report["totals"]) : { sent: 0, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0 } };
  });
  // Outcome-day counts are shown only when the selection-day totals are visible too (no small cohort anywhere in the campaign).
  const totals = data.totals.visibility === "visible" ? data.totals as Shaped : null;
  const withheld = outcomes.withheld || !totals, byOutcome = new Map<string, Counts>();
  for (const row of outcomes.days) {
    const day = byOutcome.get(row.day) ?? { sent: 0, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0 };
    day[row.metric] = row.count;
    byOutcome.set(row.day, day);
  }
  const outcomeDays = days.map(({ day }) => ({ day, counts: withheld ? null : byOutcome.get(day) ?? { sent: 0, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0 } }));
  const status = totals ? { selected: totals.selected, skipped: totals.skipped, queued: totals.queued, failed: totals.failed, unknown: totals.unknown, operatorReview: totals.operatorReview,
    accepted: totals.providerAccepted.count ?? 0, delivered: totals.outcomes.delivered.count ?? 0 } : null;
  return { campaign, sent: true, range, generatedAt: now.toISOString(), totals: counts(data.totals), days, outcomeDays, outcomesArchived: outcomes.archived, status,
    clicks: report.clicks ? clickFigures(report.clicks, days.map((day) => day.day)) : null };
}

/** The deployment has no suppression keys, so aggregates cannot be computed: the pages show "Analytics unavailable" instead of an error page. */
export const analyticsUnavailable = (error: unknown) => error instanceof Error && error.message === "NEWSLETTER_SUPPRESSION_KEYS_UNAVAILABLE";
