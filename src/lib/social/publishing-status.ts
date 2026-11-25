// Pure rules for the Publishing status read model: one state per account (delivery) and one for the whole draft. Shared by the server and, later, the Queue screens.
export const deliveryStates = ["queued", "awaiting_approval", "publishing", "published", "failed", "partial", "unknown", "cancelled"] as const;
export type DeliveryState = typeof deliveryStates[number];
export const draftStates = ["draft", ...deliveryStates] as const;
export type DraftState = typeof draftStates[number];

type PostLike = { status: string; lastErrorCode: string | null };
/** `blocked` is true when the ministry requires approval and this subject has no valid one: the post waits and the worker will not send it. */
export function deliveryState(post: PostLike, blocked: boolean): DeliveryState {
  switch (post.status) {
    case "scheduled": case "draft": return blocked ? "awaiting_approval" : "queued";
    case "publishing": return "publishing";
    case "published": return "published";
    case "failed": return post.lastErrorCode === "PARTIAL_PUBLISH" ? "partial" : "failed";
    case "unknown": return "unknown";
    default: return "cancelled";
  }
}
export function draftState(states: readonly DeliveryState[]): DraftState {
  if (!states.length) return "draft";
  const has = (s: DeliveryState) => states.includes(s);
  if (states.every(s => s === "cancelled")) return "cancelled";
  const live = states.filter(s => s !== "cancelled");
  if (live.every(s => s === "published")) return "published";
  if (live.every(s => s === "awaiting_approval")) return "awaiting_approval";
  if (live.every(s => s === "queued" || s === "awaiting_approval")) return "queued";
  // Work is still moving: something is sending, or some accounts are done while others still wait.
  if (has("publishing") || live.some(s => s === "queued" || s === "awaiting_approval")) return "publishing";
  // Everything left is terminal or unconfirmed.
  if (has("partial") || (has("published") && live.some(s => s !== "published"))) return "partial";
  if (has("unknown")) return "unknown";
  return "failed";
}
export const bucketOf = (draft: DraftState): "drafts" | "scheduled" | "sent" =>
  draft === "draft" ? "drafts" : draft === "queued" || draft === "awaiting_approval" || draft === "publishing" ? "scheduled" : "sent";
