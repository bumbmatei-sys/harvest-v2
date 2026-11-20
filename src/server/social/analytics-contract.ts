import type { Metrics, PostMetric } from "../../lib/social/analytics";
import type { SocialPlatform } from "../../lib/social/platforms";

export type AnalyticsQuery = { accountRef: string; platform: SocialPlatform; signal: AbortSignal };
export type AnalyticsDayRange = { from: string; to: string };
export type AnalyticsPost = { ref: string; nativeRef?: string; publishedAt: Date; metrics: Metrics<PostMetric> };
export type AnalyticsPosts = { posts: AnalyticsPost[]; nextPage: number | null; pending: boolean; retryAfterMs?:number };
export type AnalyticsSlot = { day: number; hour: number; engagement: number; samples: number };
