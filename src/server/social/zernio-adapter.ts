import { SocialProviderError, type SocialProvider, type SocialSender } from "./port";
import { verifyBodySignature } from "./webhook-signature";
import { socialPlatforms, type Comment, type CommentReplyRequest, type Conversation, type InboundEvent, type InboundEventKind, type Message, type Page, type PageQuery,
  type PostStatusResult, type ProviderPostStatus, type PublishRequest, type PublishResult, type SendMessageRequest, type SendResult, type SocialAccount,
  type SocialAccountHealth, type SocialCredential, type SocialPlatform } from "./types";

// The ONLY module that names the vendor host or speaks the vendor wire format. Nothing outside this file (and the registry that
// constructs it) may import it, mention the host, or import a vendor HTTP client (scripts/source-guards.ts, tests/unit/social-source-guard.test.ts).
//
// Intentionally a constant, not an environment toggle (same pattern as MANAGED_KEY_SERVICE_ENABLED and COMMUNITY_EMAIL_LIVE_DELIVERY).
// While false, the adapter cannot make a network call: without an injected fetch it throws DISABLED before any request.
// Enabling needs a separate change: DPA, sandbox verification, key ownership, rate-limit plan and independent security review.
export const ZERNIO_LIVE_NETWORK = false;
export const ZERNIO_BASE_URL = "https://zernio.com/api/v1";
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type ZernioOptions = {
  /** Tests only. The registry never passes this. */
  fetch?: FetchLike;
  baseUrl?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};
const MAX_BACKOFF_MS = 30_000;
const isPlatform = (value: unknown): value is SocialPlatform => (socialPlatforms as readonly string[]).includes(value as string);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const text = (value: unknown, max = 200): string | null => (typeof value === "string" && value.length >= 1 && value.length <= max ? value : null);
const date = (value: unknown): Date | null => { if (typeof value !== "string") return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; };
const postStatuses: readonly ProviderPostStatus[] = ["scheduled", "publishing", "published", "partial", "failed", "cancelled"];
// Retry-After is seconds (assumption from the public docs). Bounded so a hostile value cannot park a worker.
const retryAfter = (header: string | null) => { const seconds = header && /^\d{1,5}$/.test(header) ? Number(header) : null; return seconds === null ? null : Math.min(seconds * 1000, MAX_BACKOFF_MS); };
const enc = encodeURIComponent;

export class ZernioAdapter implements SocialProvider, SocialSender {
  readonly id = "zernio" as const;
  readonly signatureHeader = "x-zernio-signature";
  private readonly send: FetchLike;
  private readonly base: string;
  private readonly attempts: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  constructor(options: ZernioOptions = {}) {
    // The hard-disable: no injected fetch and no activation constant means no request, ever.
    this.send = options.fetch ?? (ZERNIO_LIVE_NETWORK ? (url, init) => globalThis.fetch(url, init) : () => { throw new SocialProviderError("DISABLED"); });
    this.base = (options.baseUrl ?? ZERNIO_BASE_URL).replace(/\/$/, "");
    this.attempts = Math.max(1, Math.min(options.maxAttempts ?? 3, 5));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => new Date());
  }

  /** One logical call. Retries only when `idempotent`; maps every failure to a fixed provider error. */
  private async call(cred: SocialCredential, method: "GET" | "POST" | "DELETE", path: string, options: { body?: unknown; headers?: Record<string, string>; idempotent: boolean }): Promise<unknown> {
    const attempts = options.idempotent ? this.attempts : 1;
    let last: SocialProviderError = new SocialProviderError("UNAVAILABLE");
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try { return await this.once(cred, method, path, options); }
      catch (error) {
        if (!(error instanceof SocialProviderError)) throw new SocialProviderError("UNAVAILABLE");
        last = error;
        if (!error.retryable || attempt === attempts) throw error;
        // Exponential backoff from 500 ms; the provider's own Retry-After wins when longer.
        await this.sleep(Math.min(Math.max(error.retryAfterMs ?? 0, 500 * 2 ** (attempt - 1)), MAX_BACKOFF_MS));
      }
    }
    throw last;
  }
  private async once(cred: SocialCredential, method: string, path: string, options: { body?: unknown; headers?: Record<string, string> }): Promise<unknown> {
    let response: Response;
    try {
      response = await this.send(`${this.base}${path}`, {
        method, signal: AbortSignal.timeout(this.timeoutMs),
        headers: { Authorization: `Bearer ${cred.secret}`, Accept: "application/json", ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...options.headers },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      // DISABLED is thrown before any request; anything else (network, timeout) is a transient provider failure.
      if (error instanceof SocialProviderError) throw error;
      throw new SocialProviderError("UNAVAILABLE");
    }
    if (response.status === 204) return {};
    if (response.status >= 200 && response.status < 300) {
      try { return await response.json(); } catch { throw new SocialProviderError("UNAVAILABLE"); }
    }
    // Bodies are never read or kept for failures: they can echo request content.
    const status = response.status;
    if (status === 401 || status === 403) throw new SocialProviderError("AUTH");
    if (status === 404) throw new SocialProviderError("NOT_FOUND");
    if (status === 409) throw new SocialProviderError("CONFLICT");
    if (status === 429) throw new SocialProviderError("RATE_LIMITED", retryAfter(response.headers.get("retry-after")));
    if (status >= 500) throw new SocialProviderError("UNAVAILABLE", retryAfter(response.headers.get("retry-after")));
    throw new SocialProviderError("INVALID_REQUEST");
  }

  async listAccounts(cred: SocialCredential): Promise<SocialAccount[]> {
    const body = record(await this.call(cred, "GET", "/accounts", { idempotent: true }));
    const raw = Array.isArray(body.accounts) ? body.accounts : [];
    return raw.flatMap((entry): SocialAccount[] => {
      const a = record(entry), accountRef = text(a._id ?? a.id), platform = a.platform;
      // Accounts on networks Harvest does not support yet are not offered.
      return accountRef && isPlatform(platform) ? [{ accountRef, platform, displayName: text(a.displayName ?? a.username, 120) }] : [];
    });
  }
  async getAccountHealth(cred: SocialCredential, accountRef: string): Promise<SocialAccountHealth> {
    const body = record(await this.call(cred, "GET", `/accounts/${enc(accountRef)}/health`, { idempotent: true }));
    const status = text(record(body.health).status ?? body.status, 40)?.toLowerCase();
    const health = status === "healthy" || status === "ok" ? "healthy" : status === "warning" || status === "degraded" ? "degraded" : "failing";
    return { accountRef, health, code: health === "healthy" ? null : (text(record(body.health).code ?? body.code, 60)?.replace(/[^a-z0-9_.-]/gi, "_") ?? null) };
  }
  async publishPost(cred: SocialCredential, request: PublishRequest): Promise<PublishResult> {
    const body: Record<string, unknown> = {
      content: request.content, platforms: [{ platform: request.platform, accountId: request.accountRef }],
      ...(request.media.length ? { mediaItems: request.media.map((m) => ({ type: m.kind, url: m.url })) } : {}),
      ...(request.scheduledFor ? { scheduledFor: request.scheduledFor.toISOString().replace(/\.\d{3}Z$/, ""), timezone: "UTC" } : { publishNow: true }),
    };
    // One key per logical post, sent on every attempt: the provider returns the original for 24 hours, so a retry cannot double-post.
    const parsed = record(await this.call(cred, "POST", "/posts", { body, headers: { "Idempotency-Key": request.idempotencyKey }, idempotent: true }));
    const post = record(parsed.post), postRef = text(post._id ?? post.id), status = post.status;
    if (!postRef) throw new SocialProviderError("UNAVAILABLE");
    return { postRef, status: postStatuses.includes(status as ProviderPostStatus) ? status as ProviderPostStatus : "publishing" };
  }
  async cancelPost(cred: SocialCredential, postRef: string): Promise<void> { await this.call(cred, "DELETE", `/posts/${enc(postRef)}`, { idempotent: true }); }
  async getPostStatus(cred: SocialCredential, postRef: string): Promise<PostStatusResult> {
    const post = record(record(await this.call(cred, "GET", `/posts/${enc(postRef)}`, { idempotent: true })).post);
    const status = postStatuses.includes(post.status as ProviderPostStatus) ? post.status as ProviderPostStatus : "publishing";
    const failed = (Array.isArray(post.platforms) ? post.platforms : []).map(record).find((p) => text(p.errorCategory));
    return { postRef, status, errorCategory: failed ? safeCode(failed.errorCategory) : null };
  }
  private query(query: { accountRef: string; cursor?: string; limit?: number }) {
    const params = new URLSearchParams({ accountId: query.accountRef, limit: String(Math.min(Math.max(query.limit ?? 25, 1), 100)) });
    if (query.cursor) params.set("cursor", query.cursor);
    return params.toString();
  }
  async listConversations(cred: SocialCredential, query: PageQuery): Promise<Page<Conversation>> {
    const body = record(await this.call(cred, "GET", `/inbox/conversations?${this.query(query)}`, { idempotent: true }));
    const items = (Array.isArray(body.data) ? body.data : []).flatMap((entry): Conversation[] => {
      const c = record(entry), conversationRef = text(c.id), platform = c.platform;
      if (!conversationRef || !isPlatform(platform)) return [];
      return [{ conversationRef, accountRef: query.accountRef, platform, participantName: text(c.participantName, 200), lastMessagePreview: text(c.lastMessage, 500),
        updatedAt: date(c.updatedTime), unreadCount: Number.isInteger(c.unreadCount) && (c.unreadCount as number) >= 0 ? c.unreadCount as number : 0 }];
    });
    return { items, nextCursor: text(record(body.pagination).nextCursor, 500) };
  }
  async listMessages(cred: SocialCredential, query: PageQuery & { conversationRef: string }): Promise<Page<Message>> {
    const body = record(await this.call(cred, "GET", `/inbox/conversations/${enc(query.conversationRef)}/messages?${this.query(query)}`, { idempotent: true }));
    const items = (Array.isArray(body.data) ? body.data : []).flatMap((entry): Message[] => {
      const m = record(entry), messageRef = text(m.id);
      return messageRef ? [{ messageRef, conversationRef: query.conversationRef, direction: m.direction === "outgoing" ? "outgoing" : "incoming", text: text(m.text, 10_000), sentAt: date(m.createdAt ?? m.timestamp) }] : [];
    });
    return { items, nextCursor: text(record(body.pagination).nextCursor, 500) };
  }
  async listComments(cred: SocialCredential, query: PageQuery & { postRef: string }): Promise<Page<Comment>> {
    const body = record(await this.call(cred, "GET", `/inbox/comments/${enc(query.postRef)}?${this.query(query)}`, { idempotent: true }));
    const items = (Array.isArray(body.comments) ? body.comments : []).flatMap((entry): Comment[] => {
      const c = record(entry), commentRef = text(c.id);
      return commentRef ? [{ commentRef, postRef: query.postRef, authorName: text(record(c.from).name, 200), text: text(c.message, 10_000), createdAt: date(c.createdTime) }] : [];
    });
    return { items, nextCursor: text(record(body.pagination).cursor, 500) };
  }

  verifyWebhook(rawBody: string, signature: string | null, secrets: readonly string[]) { return verifyBodySignature(rawBody, signature, secrets); }
  parseWebhookEvent(rawBody: string): InboundEvent | null {
    let parsed: unknown;
    try { parsed = JSON.parse(rawBody); } catch { return null; }
    const b = record(parsed), eventId = text(b.id), name = text(b.event, 100);
    if (!eventId || !name) return null;
    // Providers sign the body but not a timestamp. A missing timestamp falls back to receipt time.
    const occurredAt = b.timestamp === undefined ? this.now() : date(b.timestamp);
    if (!occurredAt) return null;
    const map: Record<string, InboundEventKind> = { "post.scheduled": "post.scheduled", "post.published": "post.published", "post.partial": "post.partial", "post.failed": "post.failed",
      "post.cancelled": "post.cancelled", "account.connected": "account.connected", "account.disconnected": "account.disconnected", "message.received": "message.received",
      "message.sent": "message.sent", "message.failed": "message.failed", "comment.received": "comment.received" };
    const kind = map[name] ?? "other", post = record(b.post), account = record(b.account), message = record(b.message), comment = record(b.comment);
    const firstTarget = record((Array.isArray(post.platforms) ? post.platforms : [])[0]);
    const failed = (Array.isArray(post.platforms) ? post.platforms : []).map(record).find((p) => text(p.errorCategory));
    const platform = [account.platform, message.platform, firstTarget.platform].find(isPlatform) ?? null;
    // Only identifiers leave this function. Message and comment text, sender names and similar content are dropped here.
    return {
      eventId, kind, rawType: kind === "other" ? safeCode(name) ?? "" : "",
      accountRef: text(account.accountId ?? account.id) ?? text(firstTarget.accountId),
      subjectRef: kind.startsWith("post.") ? text(post.id ?? post._id) : kind.startsWith("message.") ? text(message.conversationId) : kind === "comment.received" ? text(comment.id) : null,
      platform, errorCategory: failed ? safeCode(failed.errorCategory) : null, occurredAt,
    };
  }

  async sendMessage(cred: SocialCredential, request: SendMessageRequest): Promise<SendResult> {
    // No retry: this call has no documented idempotency key, so a retry could message a person twice.
    const body = record(await this.call(cred, "POST", `/inbox/conversations/${enc(request.conversationRef)}/messages`, { body: { accountId: request.accountRef, message: request.text }, idempotent: false }));
    const ref = text(record(body.message).id ?? body.messageId ?? body.id);
    if (!ref) throw new SocialProviderError("UNAVAILABLE");
    return { ref };
  }
  async replyToComment(cred: SocialCredential, request: CommentReplyRequest): Promise<SendResult> {
    const body = record(await this.call(cred, "POST", `/inbox/comments/${enc(request.postRef)}`, { body: { accountId: request.accountRef, commentId: request.commentRef, message: request.text }, idempotent: false }));
    const ref = text(record(body.comment).id ?? body.commentId ?? body.id);
    if (!ref) throw new SocialProviderError("UNAVAILABLE");
    return { ref };
  }
}
function safeCode(value: unknown): string | null { const v = text(value, 60); return v ? v.replace(/[^a-z0-9_.-]/gi, "_") : null; }
