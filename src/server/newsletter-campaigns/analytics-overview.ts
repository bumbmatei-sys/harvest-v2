import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { newsletterCampaigns } from "../../db/schema";
import { eachDay, hideSmall, periodRange, type AnalyticsOverview, type AnalyticsPeriod, type CampaignAnalytics, type CampaignFigures, type Counts } from "../../lib/newsletter-analytics";
import { audienceOverview } from "../newsletter-audience";
import { id as idOf, unavailable, withNewsletter } from "./access";
import { analyticsIn } from "./analytics";

const maxCampaigns = 50;
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
    const candidates = await tx.select({ id: newsletterCampaigns.id, name: newsletterCampaigns.name, state: newsletterCampaigns.state })
      .from(newsletterCampaigns).where(and(eq(newsletterCampaigns.tenantId, tenant), inArray(newsletterCampaigns.state, ["sending", "sent", "partial", "failed", "cancelled"])))
      .orderBy(sql`${newsletterCampaigns.frozenAt} desc nulls last`, desc(newsletterCampaigns.id)).limit(maxCampaigns + 1);
    const rows: CampaignFigures[] = [];
    for (const campaign of candidates.slice(0, maxCampaigns)) {
      const own = await analyticsIn(tx, tenant, range, campaign.id);
      if (own.days.length) rows.push({ id: campaign.id, name: campaign.name, state: campaign.state, counts: counts(own.totals) });
    }
    return { overall, rows, truncated: candidates.length > maxCampaigns };
  });
  const byDay = new Map(report.overall.days.map((day) => [day.day, day]));
  const days = eachDay(range).map((day) => {
    const found = byDay.get(day);
    return { day, counts: found ? counts(found as Report["totals"]) : { sent: 0, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0 } };
  });
  const status = (await audienceOverview(db, actor, workspace)).counts;
  return { period, range, generatedAt: now.toISOString(), totals: counts(report.overall.totals), days, campaigns: report.rows, campaignsTruncated: report.truncated,
    audience: { subscribed: hideSmall(status.subscribed), unsubscribed: hideSmall(status.unsubscribed), suppressed: hideSmall(status.suppressed) } };
}

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
    return { campaign, report: sentStates.includes(campaign.state) ? await analyticsIn(tx, tenant, range, campaign.id) : null };
  });
  const { campaign, report: data } = report;
  if (!data) return { campaign, sent: false, range, generatedAt: now.toISOString(), totals: null, days: [], status: null };
  const byDay = new Map(data.days.map((day) => [day.day, day]));
  const all = eachDay(range), firstIndex = Math.max(0, all.findIndex((day) => byDay.has(day)));
  const days = all.slice(Math.min(firstIndex, all.length - 7)).map((day) => {
    const found = byDay.get(day);
    return { day, counts: found ? counts(found as Report["totals"]) : { sent: 0, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0 } };
  });
  const totals = data.totals.visibility === "visible" ? data.totals as Shaped : null;
  const status = totals ? { selected: totals.selected, skipped: totals.skipped, queued: totals.queued, failed: totals.failed, unknown: totals.unknown, operatorReview: totals.operatorReview,
    accepted: totals.providerAccepted.count ?? 0, delivered: totals.outcomes.delivered.count ?? 0 } : null;
  return { campaign, sent: true, range, generatedAt: now.toISOString(), totals: counts(data.totals), days, status };
}

/** The deployment has no suppression keys, so aggregates cannot be computed: the pages show "Analytics unavailable" instead of an error page. */
export const analyticsUnavailable = (error: unknown) => error instanceof Error && error.message === "NEWSLETTER_SUPPRESSION_KEYS_UNAVAILABLE";
