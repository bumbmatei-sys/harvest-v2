import type { SocialPlatform } from "./platforms";

// Browser side of the Analytics routes (docs/acceptance/social-analytics.md). Types mirror the route responses. Nothing here computes a metric:
// the server is the only authority, and a reading with a null value is "unavailable", never zero.
export type Availability = "available" | "partial" | "unavailable";
export type Reading = { value: number | null; availability: Availability };
export type SeriesPoint = Reading & { day: string };
export type AccountStatus = "pending" | "ready" | "partial" | "delayed" | "expired" | "unavailable";
export const exposureMetrics = ["reach", "impressions", "views"] as const;
export type ExposureMetric = typeof exposureMetrics[number];
export type Summary = {
  published: Reading; reach: Reading; impressions: Reading; views: Reading; engagement: Reading; followerChange: Reading;
  exposure: { metric: ExposureMetric; reading: Reading };
};
export type AccountReport = {
  id: string; platform: SocialPlatform; displayName: string; connectionState: string; status: AccountStatus; lastRefreshedAt: string | null;
  summary: Summary; series: SeriesPoint[];
};
export type PlatformReport = { platform: SocialPlatform; summary: Summary; series: SeriesPoint[] };
export const postMetricKeys = ["impressions", "reach", "views", "likes", "comments", "shares", "saves", "clicks", "videoViews", "watchTimeSeconds", "score", "engagement"] as const;
export type PostMetricKey = typeof postMetricKeys[number];
export type PostRow = {
  ref: string; plannerPostId: string | null; publishedAt: string; connectionId: string; platform: SocialPlatform;
  metrics: Record<PostMetricKey, Reading>;
};
export type HeatCell = { day: number; hour: number; averageEngagement: number | null; samples: number };
export type AnalyticsReport = {
  range: { from: string; to: string; timezone: string };
  partial: boolean; truncated: boolean; retryAfter?: number; lastRefreshedAt: string | null; etag?: string;
  summary: Summary; platforms: PlatformReport[]; accounts: AccountReport[];
  series: { metric: string; points: SeriesPoint[] };
  topPosts: PostRow[]; bottomPosts: PostRow[];
  bestTimes: { timezone: string; heatmap: HeatCell[]; provider: { timezone: string; heatmap: HeatCell[] } };
};
export type PostDetailReport = {
  range: AnalyticsReport["range"]; partial: boolean; truncated: boolean; lastRefreshedAt: string | null;
  account: AccountReport;
  post: PostRow & { series: SeriesPoint[] } | (PostRow & { series?: undefined });
};

export type SeriesMetric = "published" | ExposureMetric | "engagement" | "followerChange";
export const unavailableReading: Reading = { value: null, availability: "unavailable" };

const dayMs = 86_400_000;
const dayMillis = (day: string) => Date.parse(`${day}T00:00:00Z`);
const dayString = (millis: number) => new Date(millis).toISOString().slice(0, 10);
export const addDays = (day: string, delta: number) => dayString(dayMillis(day) + delta * dayMs);
export const daysInRange = (from: string, to: string) => Math.round((dayMillis(to) - dayMillis(from)) / dayMs) + 1;

/** Today's calendar date in an IANA zone, as YYYY-MM-DD. */
export function todayIn(timezone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${pick("year")}-${pick("month")}-${pick("day")}`;
  } catch { return now.toISOString().slice(0, 10); }
}
export const presets = [7, 28, 90] as const;
export type Preset = typeof presets[number];
/** The last N days ending today, inclusive. */
export function presetRange(days: number, today: string) { return { from: addDays(today, -(days - 1)), to: today }; }
/** The period of the same length that ends the day before `from`. */
export function previousRange(from: string, to: string) { const length = daysInRange(from, to); return { from: addDays(from, -length), to: addDays(from, -1) }; }
export function rangeIsValid(from: string, to: string) {
  const ok = /^\d{4}-\d{2}-\d{2}$/;
  if (!ok.test(from) || !ok.test(to) || Number.isNaN(dayMillis(from)) || Number.isNaN(dayMillis(to))) return false;
  const length = daysInRange(from, to);
  return length >= 1 && length <= 366;
}
export function matchPreset(from: string, to: string, today: string): Preset | null {
  return presets.find((days) => { const range = presetRange(days, today); return range.from === from && range.to === to; }) ?? null;
}

export type Scope = { kind: "all" } | { kind: "platform"; platform: SocialPlatform } | { kind: "account"; id: string };
export function scopeValue(scope: Scope) { return scope.kind === "all" ? "all" : scope.kind === "platform" ? `platform:${scope.platform}` : `account:${scope.id}`; }
export function parseScope(value: string): Scope {
  if (value.startsWith("platform:")) return { kind: "platform", platform: value.slice(9) as SocialPlatform };
  if (value.startsWith("account:")) return { kind: "account", id: value.slice(8) };
  return { kind: "all" };
}
export function analyticsQuery(range: { from: string; to: string }, timezone: string, scope: Scope, metric: SeriesMetric | "engagement") {
  const query = new URLSearchParams({ from: range.from, to: range.to, timezone, metric });
  if (scope.kind === "platform") query.set("platform", scope.platform);
  if (scope.kind === "account") query.set("connectionId", scope.id);
  return query;
}

export type Delta = { direction: "up" | "down" | "flat"; percent: number | null; difference: number };
/** Change against the previous period. Unavailable on either side gives no delta, and a zero baseline gives a difference without a percentage. */
export function deltaOf(current: Reading | undefined, previous: Reading | undefined): Delta | null {
  if (!current || !previous || current.value === null || previous.value === null) return null;
  const difference = current.value - previous.value;
  const direction = difference > 0 ? "up" : difference < 0 ? "down" : "flat";
  return { direction, difference, percent: previous.value === 0 ? null : (difference / Math.abs(previous.value)) * 100 };
}

export function hasAnyValue(points: readonly SeriesPoint[]) { return points.some((point) => point.value !== null); }
export function maxHeat(cells: readonly HeatCell[]) { return cells.reduce((max, cell) => cell.averageEngagement !== null && cell.averageEngagement > max ? cell.averageEngagement : max, 0); }
export function bestSlot(cells: readonly HeatCell[]): HeatCell | null {
  let best: HeatCell | null = null;
  for (const cell of cells) if (cell.averageEngagement !== null && (best === null || cell.averageEngagement > best.averageEngagement!)) best = cell;
  return best;
}
export function heatLevel(value: number | null, max: number) { return value === null || max <= 0 ? 0 : Math.max(0.12, Math.min(1, value / max)); }

export type AccountIssues = { expired: AccountReport[]; delayed: AccountReport[]; pending: AccountReport[]; unavailable: AccountReport[] };
export function accountIssues(accounts: readonly AccountReport[]): AccountIssues {
  return {
    expired: accounts.filter((account) => account.status === "expired"),
    delayed: accounts.filter((account) => account.status === "delayed" || account.status === "partial"),
    pending: accounts.filter((account) => account.status === "pending"),
    unavailable: accounts.filter((account) => account.status === "unavailable"),
  };
}
/** Accounts exist but nothing was published or measured in the range: every card is unavailable or a plain zero and no post ranks. */
export const hasNoData = (report: AnalyticsReport) => report.accounts.length > 0 && !report.topPosts.length
  && [report.summary.published, report.summary.engagement, report.summary.exposure.reading, report.summary.followerChange].every((reading) => reading.value === null || reading.value === 0);
