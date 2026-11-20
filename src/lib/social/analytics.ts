import { z } from "zod";
import type { SocialPlatform } from "./platforms";

export const postMetrics = ["impressions", "reach", "views", "likes", "comments", "shares", "saves", "clicks", "videoViews", "watchTimeSeconds", "score"] as const;
export const accountMetrics = ["followers", "profileViews"] as const;
export type PostMetric = typeof postMetrics[number];
export type AccountMetric = typeof accountMetrics[number];
export type Metrics<M extends string> = Partial<Record<M, number>>;
export const analyticsRetentionDays = 397;
export const analyticsStatuses = ["pending", "ready", "partial", "delayed", "expired", "unavailable"] as const;
export type AnalyticsStatus = typeof analyticsStatuses[number];

const supportedPostMetrics: Partial<Record<SocialPlatform, readonly PostMetric[]>> = {
  twitter: ["impressions","likes","comments","shares","saves","clicks"],
  instagram: ["impressions","reach","views","likes","comments","shares","saves","videoViews","watchTimeSeconds"],
  facebook: ["reach","views","likes","comments","shares","clicks","videoViews","watchTimeSeconds"],
  linkedin: ["impressions","reach","likes","comments","shares","clicks"],
  tiktok: ["views","likes","comments","shares","clicks","videoViews","watchTimeSeconds"],
  youtube: ["views","likes","comments","shares","videoViews","watchTimeSeconds"],
  pinterest: ["impressions","saves","clicks"],
  reddit: ["score","comments"],
  bluesky: ["likes","comments","shares"],
  threads: ["views","likes","comments","shares"],
  snapchat: ["views","reach","shares"],
};
const accountViews: readonly SocialPlatform[] = ["instagram","facebook","tiktok"];
const followerPlatforms: readonly SocialPlatform[] = ["twitter","instagram","facebook","linkedin","tiktok","youtube","pinterest","threads"];
export function analyticsCapabilities(platform: SocialPlatform) {
  return {
    post: supportedPostMetrics[platform] ?? [],
    account: [...(followerPlatforms.includes(platform) ? ["followers" as const] : []),
      ...(accountViews.includes(platform) ? ["profileViews" as const] : [])],
    bestTimes: !!supportedPostMetrics[platform],
  };
}

export function projectMetrics<M extends string>(metrics: Record<string, unknown>, allowed: readonly M[]): Metrics<M> {
  const result: Metrics<M> = {};
  for (const key of allowed) {
    const value = metrics[key];
    if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER && (key === "score" || value >= 0)) result[key] = value;
  }
  return result;
}

export const isoAnalyticsDay = z.iso.date();
export const analyticsTimezone = z.string().max(80).refine(value => {
  try { new Intl.DateTimeFormat("en", {timeZone:value}).format(); return !/^[+-]/.test(value); } catch { return false; }
});
