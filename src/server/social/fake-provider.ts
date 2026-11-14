import { SocialProviderError, type SocialProvider, type SocialSender } from "./port";
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
    const known: InboundEventKind[] = ["post.scheduled", "post.published", "post.partial", "post.failed", "post.cancelled", "account.connected", "account.disconnected", "message.received", "message.sent", "message.failed", "comment.received"];
    const kind = known.find((k) => k === type) ?? "other";
    const platform = ["facebook", "instagram", "threads", "tiktok", "youtube"].find((p) => p === b.platform) as InboundEvent["platform"] | undefined;
    return { eventId, kind, rawType: kind === "other" ? type : "", accountRef: str(b.accountRef), subjectRef: str(b.subjectRef), platform: platform ?? null, errorCategory: str(b.errorCategory, 60), occurredAt: at };
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
  /** Test helper: a signed delivery body for this fake's wire format. */
  signedEvent(event: { id: string; type: string; timestamp: string; accountRef?: string; subjectRef?: string; platform?: string; errorCategory?: string }, secret: string) {
    const rawBody = JSON.stringify(event);
    return { rawBody, signature: signBody(rawBody, secret) };
  }
}
