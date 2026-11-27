import { z } from "zod";
import type { Database } from "../../db/client";
import type { Counts } from "../../lib/newsletter-analytics";
import { newsletterAnalyticsOverview, newsletterCampaignAnalytics } from "./analytics-overview";

const query = z.union([
  z.object({ campaignId: z.uuid() }).strict(),
  z.object({ period: z.enum(["7", "30", "90"]).default("30") }).strict(),
]);

export function statisticsPoint(counts: Counts | null, clicks: number | null) {
  return {
    sends: counts?.sent ?? null,
    opens: null,
    clicks,
    unsubscribes: counts?.unsubscribed ?? null,
  };
}

export async function newsletterStatistics(db: Database, actor: string, workspace: string, raw: unknown, now = new Date()) {
  const selection = query.parse(raw);
  if ("campaignId" in selection) {
    const report = await newsletterCampaignAnalytics(db, actor, workspace, selection.campaignId, now);
    const clicksByDay = new Map(report.clicks?.days.map(({ day, clicks }) => [day, clicks]));
    return {
      range: report.range,
      campaign: report.campaign,
      opensCollected: false,
      totals: statisticsPoint(report.totals, report.clicks?.total ?? null),
      days: report.days.map(({ day, counts }) => ({ day, ...statisticsPoint(counts, clicksByDay.get(day) ?? null) })),
    };
  }
  const period = selection.period === "7" ? 7 : selection.period === "90" ? 90 : 30;
  const report = await newsletterAnalyticsOverview(db, actor, workspace, period, now);
  const clicksByDay = new Map(report.clicks.days.map(({ day, clicks }) => [day, clicks]));
  return {
    range: report.range,
    opensCollected: false,
    totals: statisticsPoint(report.totals, report.clicks.total),
    days: report.days.map(({ day, counts }) => ({ day, ...statisticsPoint(counts, clicksByDay.get(day) ?? null) })),
    campaigns: report.campaigns.map(({ id, name, state, counts, clicks }) => ({
      id, name, state, ...statisticsPoint(counts, clicks ?? null),
    })),
    campaignsTruncated: report.campaignsTruncated,
  };
}
