/**
 * Newsletter analytics view model. Pure (no imports), shared by the server and the screen.
 * Every figure is an aggregate of delivery records over a UTC window of at most 90 days; a figure the server withheld (a cohort of fewer
 * than 5) is `null` and is shown as "Fewer than 5", never as zero.
 */
export const analyticsPeriods = [7, 30, 90] as const;
export type AnalyticsPeriod = typeof analyticsPeriods[number];
export const analyticsSorts = ["name", "sent", "delivered", "bounced", "complained", "unsubscribed", "clicks"] as const;
export type AnalyticsSort = typeof analyticsSorts[number];
export const MIN_COHORT = 5;

export type Counts = { sent: number; delivered: number; bounced: number; complained: number; unsubscribed: number };
export type DayPoint = { day: string; counts: Counts | null };
/** Link clicks per campaign (null: withheld). Clicks may include link scanners; they are never per person. */
export type CampaignFigures = { id: string; name: string; state: string; counts: Counts | null; clicks?: number | null };
/** Aggregate link clicks. `counting` is the ministry's current setting; figures recorded while it was on stay visible after it is turned off. */
export type ClickFigures = { counting: boolean; total: number | null; days: { day: string; clicks: number | null }[]; links: { url: string; clicks: number }[] };
export type AudienceFigures = { subscribed: number | null; unsubscribed: number | null; suppressed: number | null };
export type AnalyticsOverview = {
  period: AnalyticsPeriod;
  range: { from: string; until: string };
  generatedAt: string;
  /** Whole-period totals; null when any day of the period is a small cohort. */
  totals: Counts | null;
  days: DayPoint[];
  campaigns: CampaignFigures[];
  campaignsTruncated: boolean;
  audience: AudienceFigures;
  clicks: ClickFigures;
};

export const parsePeriod = (value: string | string[] | undefined): AnalyticsPeriod => {
  const number = Number(Array.isArray(value) ? value[0] : value);
  return (analyticsPeriods as readonly number[]).includes(number) ? number as AnalyticsPeriod : 30;
};
export const parseSort = (value: string | string[] | undefined): AnalyticsSort => {
  const text = Array.isArray(value) ? value[0] : value;
  return (analyticsSorts as readonly string[]).includes(text ?? "") ? text as AnalyticsSort : "sent";
};

const DAY = 86_400_000;
export const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);
/** `n` UTC days ending today (today included). `until` is exclusive, as the server expects. */
export function periodRange(period: AnalyticsPeriod, now: Date): { from: string; until: string } {
  const today = Date.parse(utcDay(now.getTime()));
  return { from: utcDay(today - (period - 1) * DAY), until: utcDay(today + DAY) };
}
/** Every UTC date in [from, until). */
export function eachDay({ from, until }: { from: string; until: string }): string[] {
  const out: string[] = [];
  for (let time = Date.parse(from); time < Date.parse(until); time += DAY) out.push(utcDay(time));
  return out;
}

/** A group of 1 to 4 people is withheld; none and 5 or more are shown. */
export const hideSmall = (value: number): number | null => value > 0 && value < MIN_COHORT ? null : value;
/** Rate in percent, or null when there is nothing to divide by. */
export const percent = (part: number, whole: number): number | null => whole > 0 ? Math.round(part / whole * 1000) / 10 : null;

export const sortCampaigns = (rows: readonly CampaignFigures[], sort: AnalyticsSort, descending: boolean): CampaignFigures[] => {
  const key = (row: CampaignFigures) => sort === "name" ? row.name.toLowerCase() : sort === "clicks" ? row.clicks ?? -1 : row.counts ? row.counts[sort] : -1;
  return [...rows].sort((a, b) => {
    const left = key(a), right = key(b);
    const order = left < right ? -1 : left > right ? 1 : 0;
    return (descending ? -order : order) || a.id.localeCompare(b.id);
  });
};

export type StatusFigures = { selected: number; skipped: number; queued: number; failed: number; unknown: number; operatorReview: number; accepted: number; delivered: number };
export type CampaignAnalytics = {
  campaign: { id: string; name: string; state: string };
  /** False for drafts and campaigns that have not been sent (sending is off): nothing to report. */
  sent: boolean;
  range: { from: string; until: string };
  generatedAt: string;
  totals: Counts | null;
  days: DayPoint[];
  /** Delivery status breakdown; null when the campaign has a small cohort. */
  status: StatusFigures | null;
  clicks: ClickFigures | null;
};
