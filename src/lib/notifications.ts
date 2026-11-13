// C15a: pure rules for in-app notifications, shared by the server, the UI and (mirrored) the SQL in migration 0041.
export const notificationKinds = ["reply", "thread_reply", "like", "application", "warning", "held_decision", "appeal_decision", "host_queue"] as const;
export type NotificationKind = typeof notificationKinds[number];
export const notificationTargets = ["post", "comment", "application", "warning", "appeal", "community"] as const;
export type NotificationTarget = typeof notificationTargets[number];

/** Badge cap: 99 shows as is, anything above reads "99+" (the label itself lives in the message catalogue). */
export const unreadCap = 99;
/** Read notifications older than this are purged. */
export const notificationRetentionDays = 90;
export const notificationListLimit = 30;
export const announcementLimit = 20;
/** Earlier repliers told about a new reply in a thread. */
export const threadReplyFanout = 50;
export const welcomeMessageMax = 1000;

export function unreadDisplay(count: number): { value: number; capped: boolean } {
  const value = Math.max(0, Math.trunc(count));
  return value > unreadCap ? { value: unreadCap, capped: true } : { value, capped: false };
}

/** The switches a member can turn off. Other kinds have no switch (only "mute this community" silences them). */
export const notificationPrefs = ["replies", "likes", "announcements"] as const;
export type NotificationPref = typeof notificationPrefs[number];
export type NotificationPrefs = Record<NotificationPref, boolean> & { muted: boolean };
export const defaultPrefs: NotificationPrefs = { replies: true, likes: true, announcements: true, muted: false };

export function prefForKind(kind: NotificationKind | "announcement"): NotificationPref | null {
  if (kind === "reply" || kind === "thread_reply") return "replies";
  if (kind === "like") return "likes";
  if (kind === "announcement") return "announcements";
  return null;
}

export type NotificationView = { id: string; kind: NotificationKind | "announcement"; targetType: NotificationTarget; postId: string | null; actorName: string | null;
  count: number; detail: Record<string, unknown>; read: boolean; createdAt: string };

/** Message key (under CommunityNotifications.summary) for one line in the bell. */
export function summaryKey(item: Pick<NotificationView, "kind" | "count" | "detail" | "targetType">): string {
  const decision = typeof item.detail.decision === "string" ? item.detail.decision : "";
  const status = typeof item.detail.status === "string" ? item.detail.status : "";
  switch (item.kind) {
    case "reply": return "reply";
    case "thread_reply": return "threadReply";
    case "like": return item.targetType === "comment" ? (item.count > 1 ? "likeReplyMany" : "likeReply") : item.count > 1 ? "likeMany" : "like";
    case "application": return status === "approved" ? "applicationApproved" : status === "info_requested" ? "applicationInfo" : "applicationDeclined";
    case "warning": return "warning";
    case "held_decision": return decision === "approve" ? "heldApproved" : "heldRejected";
    case "appeal_decision": return decision === "approve" ? "appealApproved" : "appealDeclined";
    case "host_queue": return item.count > 1 ? "hostQueueMany" : "hostQueue";
    case "announcement": return "announcement";
  }
}

/** Where clicking an item goes. Always a page of the same community (or the account page for appeals). */
export function notificationHref(slug: string, item: Pick<NotificationView, "kind" | "postId" | "detail">): string {
  const base = `/communities/${slug}`;
  if (item.kind === "host_queue") return `${base}/moderation`;
  if (item.kind === "appeal_decision") return "/account/communities";
  if (item.kind === "held_decision" && item.detail.decision !== "approve") return `${base}/forum`;
  if (item.postId) return `${base}/posts/${item.postId}`;
  return `${base}/forum`;
}
