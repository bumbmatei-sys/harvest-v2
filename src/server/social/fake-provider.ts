import type { AnalyticsDayRange, AnalyticsPost, AnalyticsQuery, AnalyticsSlot } from "./analytics-contract";
import type { AccountMetric, Metrics } from "../../lib/social/analytics";
import type { AutoDmEvent, AutoDmEvidence } from "./auto-dm-contract";
import type { InboxEntry, InboxItemQuery, InboxListQuery, InboxMessage, InboxReplyEligibility, InboxReplyQuery, InboxReplyRequest } from "./inbox-contract";
import { SocialProviderError, type SocialProvider, type SocialSender } from "./port";
import { deliveryKey } from "./types";
import { isSocialPlatform } from "../../lib/social/platforms";
import { signBody, verifyBodySignature } from "./webhook-signature";
import type {
  Comment, Conversation, InboundEvent, InboundEventKind, Message, Page, PageQuery, PostStatusResult, ProviderPostStatus, PublishRequest, PublishResult,
  SendMessageRequest, SendResult, SocialAccount, SocialAccountHealth, SocialCredential, CommentReplyRequest,
} from "./types";

type StoredPost = { postRef: string; status: ProviderPostStatus; request: PublishRequest };
export type FakeCall = { method: string; key: string | null };
export type FakeOptions = {
  /** The only credential secret this fake accepts. */
  validSecret?: string;
  /** Accept any credential and any account. Used only by the test-mode worker script, never by the contract suite. */
  permissive?: boolean;
  accounts?: SocialAccount[];
  conversations?: Conversation[];
  messages?: Message[];
  comments?: Comment[];
};

/**
 * Deterministic in-memory provider for tests and the test-mode worker. It never touches a network and has no persistence.
 * Failures are injected per method: `fail("publishPost", code, times)`.
 */
export class FakeProvider implements SocialProvider, SocialSender {
  readonly id = "fake" as const;
  readonly signatureHeader = "x-fake-signature";
  readonly calls: FakeCall[] = [];
  readonly posts = new Map<string, StoredPost>();
  readonly sent: { kind: "message" | "comment"; key: string }[] = [];
  private readonly byKey = new Map<string, string>();
  private readonly failures = new Map<string, { code: ConstructorParameters<typeof SocialProviderError>[0]; times: number; retryAfterMs: number | null }>();
  private counter = 0;
  readonly validSecret: string;
  accounts: SocialAccount[];
  conversations: Conversation[];
  messages: Message[];
  comments: Comment[];
  inboxEntries: InboxEntry[] = [];
  inboxMessages = new Map<string, InboxMessage[]>();
  replyEligibility = new Map<string, InboxReplyEligibility>();
  private readonly replyResults = new Map<string, SendResult>();
  ambiguousNextReply = false;
  health = new Map<string, SocialAccountHealth>();
  constructor(private readonly options: FakeOptions = {}) {
    this.validSecret = options.validSecret ?? "fake-credential";
    this.accounts = options.accounts ?? [];
    this.conversations = options.conversations ?? [];
    this.messages = options.messages ?? [];
    this.comments = options.comments ?? [];
  }
  /** Fail the next `times` calls to `method` with `code`. */
  fail(method: string, code: ConstructorParameters<typeof SocialProviderError>[0], times = 1, retryAfterMs: number | null = null) { this.failures.set(method, { code, times, retryAfterMs }); }
  private enter(method: string, cred: SocialCredential, key: string | null = null) {
    this.calls.push({ method, key });
    if (!this.options.permissive && cred.secret !== this.validSecret) throw new SocialProviderError("AUTH");
    const failure = this.failures.get(method);
    if (failure && failure.times > 0) { failure.times--; throw new SocialProviderError(failure.code, failure.retryAfterMs); }
  }
  private page<T>(items: T[], query: { cursor?: string; limit?: number }): Page<T> {
    const start = query.cursor ? Number(query.cursor) : 0, limit = query.limit ?? 25;
    if (!Number.isInteger(start) || start < 0) throw new SocialProviderError("INVALID_REQUEST");
    const slice = items.slice(start, start + limit);
    return { items: slice, nextCursor: start + limit < items.length ? String(start + limit) : null };
  }
  async listAccounts(cred: SocialCredential) { this.enter("listAccounts", cred); return [...this.accounts]; }
  async getAccountHealth(cred: SocialCredential, accountRef: string): Promise<SocialAccountHealth> {
    this.enter("getAccountHealth", cred);
    if (!this.accounts.some((a) => a.accountRef === accountRef)) throw new SocialProviderError("NOT_FOUND");
    return this.health.get(accountRef) ?? { accountRef, health: "healthy", code: null };
  }
  async publishPost(cred: SocialCredential, request: PublishRequest): Promise<PublishResult> {
    this.enter("publishPost", cred, request.idempotencyKey);
    const existing = this.byKey.get(request.idempotencyKey);
    if (existing) { const post = this.posts.get(existing)!; return { postRef: post.postRef, status: post.status }; }
    if (!this.options.permissive && !this.accounts.some((a) => a.accountRef === request.accountRef && a.platform === request.platform)) throw new SocialProviderError("INVALID_REQUEST");
    if (!request.content.trim() && request.media.length === 0) throw new SocialProviderError("INVALID_REQUEST");
    const postRef = `fake-post-${++this.counter}`, status: ProviderPostStatus = request.scheduledFor ? "scheduled" : "published";
    this.posts.set(postRef, { postRef, status, request });
    this.byKey.set(request.idempotencyKey, postRef);
    return { postRef, status };
  }
  async cancelPost(cred: SocialCredential, postRef: string) {
    this.enter("cancelPost", cred);
    const post = this.posts.get(postRef);
    if (!post) throw new SocialProviderError("NOT_FOUND");
    if (post.status !== "scheduled") throw new SocialProviderError("CONFLICT");
    post.status = "cancelled";
  }
  async getPostStatus(cred: SocialCredential, postRef: string): Promise<PostStatusResult> {
    this.enter("getPostStatus", cred);
    const post = this.posts.get(postRef);
    if (!post) throw new SocialProviderError("NOT_FOUND");
    return { postRef, status: post.status, errorCategory: null };
  }
  async listConversations(cred: SocialCredential, query: PageQuery) { this.enter("listConversations", cred); return this.page(this.conversations.filter((c) => c.accountRef === query.accountRef), query); }
  async listMessages(cred: SocialCredential, query: PageQuery & { conversationRef: string }) {
    this.enter("listMessages", cred);
    return this.page(this.messages.filter((m) => m.conversationRef === query.conversationRef), query);
  }
  async listComments(cred: SocialCredential, query: PageQuery & { postRef: string }) { this.enter("listComments", cred); return this.page(this.comments.filter((c) => c.postRef === query.postRef), query); }
  verifyWebhook(rawBody: string, signature: string | null, secrets: readonly string[]) { return verifyBodySignature(rawBody, signature, secrets); }
  parseWebhookEvent(rawBody: string): InboundEvent | null {
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { return null; }
    if (!body || typeof body !== "object") return null;
    const b = body as Record<string, unknown>, str = (v: unknown, max = 200) => typeof v === "string" && v.length >= 1 && v.length <= max ? v : null;
    const eventId = str(b.id), type = str(b.type, 100), at = typeof b.timestamp === "string" ? new Date(b.timestamp) : null;
    if (!eventId || !type || !at || Number.isNaN(at.getTime())) return null;
    const known: InboundEventKind[] = ["post.scheduled", "post.published", "post.partial", "post.failed", "post.cancelled", "account.connected", "account.disconnected", "message.received", "message.sent", "message.failed", "comment.received", "mention.received"];
    const kind = known.find((k) => k === type) ?? "other";
    const platform = isSocialPlatform(b.platform) ? b.platform : null;
    return { eventId, kind, activityRef: str(b.activityRef) ?? undefined, rawType: kind === "other" ? type : "", accountRef: str(b.accountRef), subjectRef: str(b.subjectRef), platform, errorCategory: str(b.errorCategory, 60), occurredAt: at,
      ...(str(b.publishedPostRef) ? { publishedPostRef:str(b.publishedPostRef)! } : {}),
      ...(kind.startsWith("post.") && deliveryKey(b.correlationKey) ? { correlationKey: b.correlationKey } : {}) };
  }
  async sendMessage(cred: SocialCredential, request: SendMessageRequest): Promise<SendResult> {
    this.enter("sendMessage", cred, request.idempotencyKey);
    this.sent.push({ kind: "message", key: request.idempotencyKey });
    return { ref: `fake-message-${++this.counter}` };
  }
  async replyToComment(cred: SocialCredential, request: CommentReplyRequest): Promise<SendResult> {
    this.enter("replyToComment", cred, request.idempotencyKey);
    this.sent.push({ kind: "comment", key: request.idempotencyKey });
    return { ref: `fake-reply-${++this.counter}` };
  }
  private inboxKey(query: InboxReplyQuery | InboxItemQuery) {
    return JSON.stringify([query.accountRef, query.kind, query.ref]);
  }
  async listInbox(cred: SocialCredential, query: InboxListQuery) {
    this.enter("listInbox", cred);
    query.signal.throwIfAborted();
    const stored = this.inboxEntries.filter(item => item.accountRef === query.accountRef && item.kind === query.kind);
    const conversations: InboxEntry[] = query.kind === "dm" ? this.conversations.filter(item => item.accountRef === query.accountRef).map(item => ({
      kind: "dm", ref: item.conversationRef, accountRef: item.accountRef, title: item.participantName,
      preview: item.lastMessagePreview, activityAt: item.updatedAt,
    })) : [];
    const search = query.search?.toLowerCase();
    const items = [...stored, ...conversations].filter(item => !search ||
      [item.title, item.preview].some(value => value?.toLowerCase().includes(search)));
    return this.page(items, query);
  }
  async readInbox(cred: SocialCredential, query: InboxItemQuery) {
    this.enter("readInbox", cred);
    query.signal.throwIfAborted();
    const entry = this.inboxEntries.find(item => item.accountRef === query.accountRef && item.kind === query.kind && item.ref === query.ref);
    const conversation = query.kind === "dm" && this.conversations.find(item => item.accountRef === query.accountRef && item.conversationRef === query.ref);
    if (!entry && !conversation) throw new SocialProviderError("NOT_FOUND");
    const messages = this.inboxMessages.get(this.inboxKey(query)) ?? (conversation ? this.messages.filter(item => item.conversationRef === query.ref)
      .map(item => ({ ref: item.messageRef, direction: item.direction, text: item.text, at: item.sentAt, attachments: [] })) : []);
    return { ...this.page(messages, query), title: entry?.title ?? (conversation ? conversation.participantName : null) };
  }
  async inboxReplyEligibility(cred: SocialCredential, query: InboxReplyQuery): Promise<InboxReplyEligibility> {
    this.enter("inboxReplyEligibility", cred);
    const { items } = await this.readInbox(cred, { ...query, limit: 100 });
    const health = await this.getAccountHealth(cred, query.accountRef);
    if (health.health !== "healthy") return { allowed: false, reason: "unhealthy" };
    if (query.targetRef && !items.some(item => item.ref === query.targetRef && item.canReply !== false && !item.deleted))
      return { allowed: false, reason: "target_unavailable" };
    return this.replyEligibility.get(this.inboxKey(query)) ?? { allowed: true, expiresAt: null, media: true, quote: true };
  }
  analyticsPosts = new Map<string, AnalyticsPost[]>();
  analyticsAccounts = new Map<string, { day: string; metrics: Metrics<AccountMetric> }[]>();
  analyticsTimes = new Map<string, AnalyticsSlot[]>();

  async readPostAnalytics(cred: SocialCredential, query: AnalyticsQuery & AnalyticsDayRange & { page: number; limit: number; order: "date" | "engagement" }) {
    this.enter("readPostAnalytics", cred);
    query.signal.throwIfAborted();
    const posts = (this.analyticsPosts.get(query.accountRef) ?? []).filter(row => {
      const day = row.publishedAt.toISOString().slice(0,10);
      return day >= query.from && day <= query.to;
    });
    const start = (query.page - 1) * query.limit;
    return { posts: posts.slice(start,start+query.limit), nextPage: start+query.limit<posts.length ? query.page+1 : null, pending:false };
  }

  async readAccountAnalytics(cred: SocialCredential, query: AnalyticsQuery & AnalyticsDayRange) {
    this.enter("readAccountAnalytics", cred);
    query.signal.throwIfAborted();
    return { days: (this.analyticsAccounts.get(query.accountRef) ?? []).filter(row => row.day >= query.from && row.day <= query.to), partial: false };
  }

  async readBestPostingTimes(cred: SocialCredential, query: AnalyticsQuery) {
    this.enter("readBestPostingTimes", cred);
    query.signal.throwIfAborted();
    return this.analyticsTimes.get(query.accountRef) ?? [];
  }

  autoDmEvidence = new Map<string, AutoDmEvidence>();

  async readAutoDmEvidence(cred: SocialCredential, query: AutoDmEvent) {
    this.enter("readAutoDmEvidence", cred);
    query.signal.throwIfAborted();
    return this.autoDmEvidence.get(JSON.stringify([query.accountRef, query.subjectRef, query.activityRef])) ?? null;
  }

  async dispatchInboxReply(cred: SocialCredential, request: InboxReplyRequest) {
    this.enter("dispatchInboxReply", cred, request.idempotencyKey);
    const previous = this.replyResults.get(request.idempotencyKey);
    if (previous) return previous;
    const result = { ref: `fake-inbox-${++this.counter}` };
    this.replyResults.set(request.idempotencyKey, result);
    this.sent.push({ kind: request.mode === "comment" ? "comment" : "message", key: request.idempotencyKey });
    if (this.ambiguousNextReply) {
      this.ambiguousNextReply = false;
      throw new SocialProviderError("UNAVAILABLE");
    }
    return result;
  }
  async reconcileInboxReply(cred: SocialCredential, request: InboxReplyQuery & { idempotencyKey: string }) {
    this.enter("reconcileInboxReply", cred, request.idempotencyKey);
    return this.replyResults.get(request.idempotencyKey) ?? null;
  }
  /** Test helper: a signed delivery body for this fake's wire format. */
  signedEvent(event: { id: string; type: string; timestamp: string; accountRef?: string; subjectRef?: string; platform?: string; errorCategory?: string }, secret: string) {
    const rawBody = JSON.stringify(event);
    return { rawBody, signature: signBody(rawBody, secret) };
  }
}
