/** Client-side types and helpers for private messages (C11c screens). The server owns every eligibility rule; nothing here decides who may be messaged. */

export type DmConversation = {
  id: string;
  latestRev: string;
  lastMessageAt: string | null;
  otherId: string | null;
  otherName: string | null;
  muted: boolean;
  canSend: boolean;
  unread: number;
};

export type DmList = {
  items: DmConversation[];
  policy: "channels_only" | "members";
  next: { at: string | null; id: string } | null;
  acceptMembers: boolean;
  /** People the viewer blocked. Never returned for the other side of a block. */
  blockedUserIds: string[];
};

export type DmMessage = {
  id: string;
  conversationId: string;
  authorId: string | null;
  clientId: string;
  body: string | null;
  seq: string;
  rev: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
};

export type DmPage = { events: DmMessage[]; cursor: string | null; hasMore: boolean };
export type DmPerson = { id: string; name: string };

export function mergeDmMessages(previous: DmMessage[], events: DmMessage[]) {
  const merged = new Map(previous.map(event => [event.id, event]));
  for (const event of events) {
    const known = merged.get(event.id);
    if (!known || BigInt(event.rev) >= BigInt(known.rev)) merged.set(event.id, event);
  }
  return [...merged.values()].sort((a, b) => BigInt(a.seq) < BigInt(b.seq) ? -1 : 1);
}

/**
 * What a failed start or send looks like to the person who tried.
 * Every refusal that depends on the other person (not a member, opted out, blocked, policy off, no reply yet) is one value, so the screen
 * cannot tell a sender why. Only the sender's own rate limit and a plain connection or sign-in problem are separate.
 */
export type DmFailure = "unavailable" | "slow" | "signIn" | "retry";

export function dmFailure(status: number, outcome?: unknown): DmFailure {
  if (status === 401) return "signIn";
  if (status === 429 || outcome === "rate_limited") return "slow";
  if (outcome === "not_available" || outcome === "unanswered_limit" || outcome === "not_found" || status === 404 || status === 403) return "unavailable";
  return "retry";
}

/** The conversation heading falls back to a neutral name when the other person has no name on record. */
export const dmName = (item: Pick<DmConversation, "otherName">, fallback: string) => item.otherName?.trim() || fallback;

export function dmUnreadTotal(items: readonly DmConversation[]) {
  return items.reduce((total, item) => total + (item.muted || item.unread <= 0 ? 0 : 1), 0);
}

/** Newest activity first, as the server returns it; used to keep the list stable when an update lands. */
export function sortDmList(items: readonly DmConversation[]) {
  return [...items].sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "") || a.id.localeCompare(b.id));
}
