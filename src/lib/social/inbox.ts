import { inboxCapabilities, type InboxKind, type SocialPlatform } from "./platforms";
import { socialRequest, SocialApiError } from "./api";

// Browser side of the Inbox routes (docs/acceptance/social-inbox.md). Types mirror the route responses. Message and comment text is live pass-through:
// nothing here stores it, and the helpers below work on metadata and shapes only.
export const inboxFolders = ["all", "unread", "assigned", "open", "done", "starred", "mentions", "comments", "dms"] as const;
export type InboxFolder = typeof inboxFolders[number];
export type InboxAccount = {
  id: string; platform: SocialPlatform; displayName: string | null; state: string; health: string; capabilityVersion: string;
  capabilities: ReturnType<typeof inboxCapabilities>;
};
export type InboxItem = {
  id: string; connectionId: string; kind: InboxKind; activityAt: string | null; status: "open" | "done"; assigneeId: string | null; starred: boolean;
  snoozedUntil: string | null; version: number; contactId: string | null; labelIds: string[]; readInHarvest: boolean; account: InboxAccount;
  /** Live from the provider; absent in local metadata search results. */
  title?: string | null; preview?: string | null;
};
export type ServiceState = { accountId: string; kind: InboxKind; state: "delayed" | "expired" | "revoked" | "denied" | "unavailable"; retryAt?: number };
export type InboxPage = { items: InboxItem[]; channels: (InboxAccount & { results: ServiceState[] })[]; partial: ServiceState[]; pendingAccountIds: string[]; nextCursor: string | null; retryAfter: number | null };
export type InboxLabel = { id: string; name: string; version: number };
export type InboxSidebar = {
  coverage: "discovered"; folders: Record<InboxFolder, number>; labels: InboxLabel[]; assignees: { id: string; name: string }[]; activityRevision: string;
  platforms: { platform: SocialPlatform; counts: Record<InboxFolder, number>; accounts: (InboxAccount & { counts: Record<InboxFolder, number> })[] }[];
};
export type ReplyMode = "message" | "comment" | "private" | "mention";
export type Eligibility = { allowed: true; expiresAt: string | null; media: boolean; quote: boolean } | { allowed: false; reason: string };
export type ThreadMessage = {
  ref: string; direction: "incoming" | "outgoing" | "unknown"; text: string | null; at: string | null; attachments: { type: string; url: string | null; name: string | null }[];
  storyReply?: boolean; storyMention?: boolean; mentionsBot?: boolean; deleted?: boolean; deliveryStatus?: string; replyTo?: string;
  capabilities?: { quote: boolean; commentReply: boolean; privateReply: boolean; mentionReply: boolean };
};
export type Conversation = {
  item: Omit<InboxItem, "account" | "title" | "preview">; account: InboxAccount; state: "available" | "delayed" | "expired" | "revoked" | "denied" | "unavailable" | string;
  title?: string | null; messages?: ThreadMessage[]; eligibility?: Partial<Record<ReplyMode, Eligibility>>; nextCursor?: string | null; retryAfter: number | null;
};
export type ItemChange = { action: "read"; value: boolean } | { action: "assign"; assigneeId: string | null } | { action: "status"; value: "open" | "done" } | { action: "star"; value: boolean };
export type Hours = { connectionId: string; version: number; timezone: string; hours: { day: number; start: string; end: string }[]; awayTemplate: string | null };
export type Receipt = { id: string; itemId: string; mode: ReplyMode; state: string; version: number; retryAt: string | null; firstAttemptAt: string | null };
export type Filters = { folder: InboxFolder; platform?: SocialPlatform; account?: string; kind?: InboxKind; label?: string };

export const inboxApi = (tenantId: string) => ({
  list: (filters: Filters, cursor?: string, signal?: AbortSignal) => socialRequest<InboxPage>(tenantId, "/inbox", { method: "POST", body: { ...filters, ...(cursor ? { cursor } : {}) }, signal }),
  metadata: (filters: Filters & { note: string }, after?: string, signal?: AbortSignal) => socialRequest<{ items: InboxItem[]; after: string | null }>(tenantId, "/inbox/metadata", { method: "POST", body: { ...filters, ...(after ? { after } : {}) }, signal }),
  conversation: (id: string, cursor?: string, signal?: AbortSignal) => cursor
    ? socialRequest<Conversation>(tenantId, `/inbox/items/${id}/conversation`, { method: "POST", body: { cursor }, signal })
    : socialRequest<Conversation>(tenantId, `/inbox/items/${id}/conversation`, { signal }),
  change: (id: string, version: number, change: ItemChange) => socialRequest<{ id: string; version: number }>(tenantId, `/inbox/items/${id}`, { method: "PATCH", body: { version, change } }),
  eligibility: (id: string, mode: ReplyMode, targetRef: string | null, signal?: AbortSignal) => socialRequest<{ eligibility: Eligibility }>(tenantId, `/inbox/items/${id}/reply-eligibility`, { method: "POST", body: { mode, targetRef }, signal }),
  reply: (id: string, body: { id: string; mode: ReplyMode; targetRef: string | null; text: string }) => socialRequest<{ reply: Receipt }>(tenantId, `/inbox/items/${id}/replies`, { method: "POST", body }),
  receipt: (id: string, replyId: string, signal?: AbortSignal) => socialRequest<{ reply: Receipt }>(tenantId, `/inbox/items/${id}/replies/${replyId}`, { signal }),
  hours: (connectionId: string, signal?: AbortSignal) => socialRequest<{ settings: Hours }>(tenantId, `/inbox/accounts/${connectionId}/hours`, { signal }),
  saveHours: (connectionId: string, body: Omit<Hours, "connectionId">) => socialRequest<{ settings: Hours }>(tenantId, `/inbox/accounts/${connectionId}/hours`, { method: "PATCH", body }),
});
export type InboxApi = ReturnType<typeof inboxApi>;

/** The sidebar answers 304 for an unchanged ETag; `null` then means "keep what you have". The ETag stays in memory only. */
export async function fetchSidebar(tenantId: string, etag: string | null, signal?: AbortSignal): Promise<{ sidebar: InboxSidebar; etag: string | null } | null> {
  let response: Response;
  try {
    response = await fetch(`/api/workspaces/${tenantId}/social/inbox/sidebar`, { cache: "no-store", signal, headers: etag ? { "If-None-Match": etag } : undefined });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new SocialApiError(0, "NETWORK");
  }
  if (response.status === 304) return null;
  const data = await response.json().catch(() => null) as (InboxSidebar & { etag?: string; error?: string }) | null;
  if (!response.ok || !data) throw new SocialApiError(response.status, null);
  return { sidebar: data, etag: response.headers.get("ETag") ?? data.etag ?? null };
}

/** Folder keys with a plain tab; the other folders live in the filter pane only. */
export const tabFolders = ["all", "unread", "assigned", "open"] as const;
export const typeFilters: readonly (InboxKind | "all")[] = ["all", "dm", "comment", "mention", "story"];

export const filtersKey = (filters: Filters, search: string) => JSON.stringify([filters, search]);
export const defaultFilters: Filters = { folder: "all" };
export const filtersActive = (filters: Filters, search = "") => filters.folder !== "all" || !!filters.platform || !!filters.account || !!filters.kind || !!filters.label || !!search.trim();

/** Why an account cannot be read right now: the state the server reports, as a catalogue key. A healthy account returns null. */
export type AccountProblem = "expired" | "unhealthy" | "unavailable" | "denied" | "revoked" | "disabled";
export function accountProblem(account: Pick<InboxAccount, "state">): AccountProblem | null {
  switch (account.state) {
    case "available": return null;
    case "expired": case "unhealthy": case "unavailable": case "denied": case "revoked": return account.state;
    default: return "disabled";
  }
}

/** Items by Harvest id (a replayed page can repeat rows), newest activity first, keeping the first occurrence's data unless the later one is newer. */
export function mergeItems(current: readonly InboxItem[], incoming: readonly InboxItem[]): InboxItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => (Date.parse(b.activityAt ?? "") || 0) - (Date.parse(a.activityAt ?? "") || 0) || a.id.localeCompare(b.id));
}
/** Messages by provider reference in time order (oldest first); messages without a time keep their arrival order at the end. */
export function mergeMessages(current: readonly ThreadMessage[], incoming: readonly ThreadMessage[]): ThreadMessage[] {
  const byRef = new Map(current.map((message) => [message.ref, message]));
  for (const message of incoming) byRef.set(message.ref, message);
  const all = [...byRef.values()];
  const time = (message: ThreadMessage) => message.at ? Date.parse(message.at) : Number.POSITIVE_INFINITY;
  return all.map((message, index) => ({ message, index })).sort((a, b) => time(a.message) - time(b.message) || a.index - b.index).map(({ message }) => message);
}

/** "Needs reply" is the open folder: Harvest cannot see the platform's reply state, so an item stays open until staff mark it done. */
export const needsReply = (item: Pick<InboxItem, "status">) => item.status === "open";
export const kindFolder: Record<InboxKind, InboxFolder> = { dm: "dms", story: "dms", comment: "comments", mention: "mentions" };
export const kindAction = (kind: InboxKind): ReplyMode => kind === "dm" || kind === "story" ? "message" : kind;

/** Replace one item in a page after a local change succeeded, without waiting for a re-read. */
export function patchItem<T extends { id: string; version: number }>(items: readonly T[], id: string, version: number, fields: Partial<T>): T[] {
  return items.map((item) => item.id === id ? { ...item, ...fields, version } : item);
}

/** Server reasons a reply cannot be sent, plus the client's own. Unknown reasons read as a generic sentence. */
export const replyReasons = ["unavailable", "expired_window", "permissions", "unhealthy", "target_unavailable", "select_target", "expired", "revoked", "denied", "delayed", "disabled"] as const;
export const replyReasonKey = (reason: string) => (replyReasons as readonly string[]).includes(reason) ? reason : "unknown";

export const weekdays = [1, 2, 3, 4, 5, 6, 7] as const;
export type DayHours = { day: number; start: string; end: string };
/** One working window per day for the settings form (the server accepts several per day; extra windows are kept and shown read-only count). */
export function hoursByDay(hours: readonly DayHours[]): Record<number, DayHours[]> {
  const result: Record<number, DayHours[]> = {};
  for (const slot of hours) (result[slot.day] ??= []).push(slot);
  return result;
}
export const validWindow = (start: string, end: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end) && start < end;

/** What is wrong with a set of working windows, if anything: the same rules the server applies (start before end, no overlap on a day, at most 28 windows). */
export function slotsProblem(slots: readonly DayHours[]): "order" | "overlap" | "many" | null {
  if (slots.length > 28) return "many";
  if (slots.some((slot) => !validWindow(slot.start, slot.end))) return "order";
  const sorted = [...slots].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  return sorted.some((slot, index) => index > 0 && sorted[index - 1].day === slot.day && sorted[index - 1].end > slot.start) ? "overlap" : null;
}
export const sortSlots = (slots: readonly DayHours[]) => [...slots].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
