// C21 community stats: shared types and the list of measures the system does not record. Periods, regions and small-group suppression are the CRM reports rules, unchanged
// (src/lib/crm-reports.ts). A figure is `null` when it is withheld (1 to 4), and a measure that is never recorded is listed under `unavailable` instead of being reported as zero.
export const communityStatsUnavailable = ["commerce", "courseProgress", "eventParticipation", "chat"] as const;
export const leaveReasons = ["moved_away", "too_busy", "not_relevant", "too_many_notifications", "content_quality", "privacy", "other"] as const;
export type LeaveReason = typeof leaveReasons[number];
export const retentionDays = [7, 30, 90] as const;
export type CommunityRetention = { cohort: number | null; retained: number | null; lost: number | null; percent: number | null };
export type CommunityStatsUnavailable = typeof communityStatsUnavailable[number];
export type CommunityStats = {
  communityId: string; period: "last7" | "last30" | "last90" | "thisMonth" | "lastMonth"; timeZone: "UTC"; generatedAt: string; window: { start: string; end: string }; minimumGroup: 5;
  /** Snapshots are as of now; `joined` is members whose membership started in the period. */
  members: { active: number | null; pending: number | null; joined: number | null };
  /** Started: applications created in the period. Approved and declined: decisions made in the period. */
  applications: { started: number | null; approved: number | null; declined: number | null; approvalPercent: number | null; averageHoursToDecision: number | null };
  /** Contributors are distinct people who posted or commented in the period. Posts and unanswered posts exclude removed and held posts, like comments. Unanswered: posts older than 24 hours without a visible comment, from the last 90 days (snapshot). */
  engagement: { posts: number | null; comments: number | null; contributors: number | null; unansweredPosts: number | null };
  /** Voluntary leaves by reason ("none" when no reason was given), and departures by a host. Retention: members who joined in the period and are old enough for the day mark, split into still-with-us and gone. */
  retention: { cancellations: number | null; byReason: Record<LeaveReason | "none", number | null>; removedByHost: number | null; days: Record<"7" | "30" | "90", CommunityRetention> };
  /** Anonymous daily counters (visits and join clicks) for the community page; join rate is members joined per visit. Indicative, not auditable: anyone can call the counter. */
  acquisition: { visits: number | null; joinClicks: number | null; joinPercentOfVisits: number | null };
  safety: { reportsOpened: number | null; reportsResolved: number | null; averageHoursToResolve: number | null; openNow: number | null };
  unavailable: readonly CommunityStatsUnavailable[];
};
