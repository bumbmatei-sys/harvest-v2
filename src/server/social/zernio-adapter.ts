import type { InboxEntry, InboxItemQuery, InboxListQuery, InboxMessage, InboxReadPage, InboxReplyEligibility, InboxReplyQuery, InboxReplyRequest } from "./inbox-contract";
import { isMediaFetchFailure, SocialProviderError, type SocialProvider, type SocialSender } from "./port";
import { verifyBodySignature } from "./webhook-signature";
import { inboxCapabilities, isSocialPlatform, type SocialPlatform } from "../../lib/social/platforms";
import { deliveryKey, type Comment, type CommentReplyRequest, type Conversation, type InboundEvent, type InboundEventKind, type Message, type Page, type PageQuery,
  type PostStatusResult, type ProviderPostStatus, type PublishRequest, type PublishResult, type SendMessageRequest, type SendResult, type SocialAccount,
  type SocialAccountHealth, type SocialCredential } from "./types";

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
const isPlatform = isSocialPlatform;
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const text = (value: unknown, max = 200): string | null => (typeof value === "string" && value.length >= 1 && value.length <= max ? value : null);
const date = (value: unknown): Date | null => { if (typeof value !== "string") return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; };
const postStatuses: readonly ProviderPostStatus[] = ["scheduled", "publishing", "published", "partial", "failed", "cancelled"];
function retryAfter(header: string | null, now: Date) {
  if (!header) return null;
  if (/^\d{1,9}$/.test(header)) return Number(header) * 1000;
  const timestamp = Date.parse(header);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now.getTime()) : null;
}
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
  private async call(cred: SocialCredential, method: "GET" | "POST" | "DELETE", path: string, options: { body?: unknown; headers?: Record<string, string>; idempotent: boolean; classifyMedia?: boolean }): Promise<unknown> {
    const attempts = options.idempotent ? this.attempts : 1;
    let last: SocialProviderError = new SocialProviderError("UNAVAILABLE");
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try { return await this.once(cred, method, path, { ...options, boundedRetryAfter: true }); }
      catch (error) {
        if (!(error instanceof SocialProviderError)) throw new SocialProviderError("UNAVAILABLE");
        last = error;
        if (!error.retryable || attempt === attempts || (error.retryAfterMs ?? 0) > MAX_BACKOFF_MS) throw error;
        // Exponential backoff from 500 ms; the provider's own Retry-After wins when longer.
        await this.sleep(Math.min(Math.max(error.retryAfterMs ?? 0, 500 * 2 ** (attempt - 1)), MAX_BACKOFF_MS));
      }
    }
    throw last;
  }
  private async once(cred: SocialCredential, method: string, path: string, options: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal; classifyMedia?: boolean; boundedRetryAfter?: boolean }): Promise<unknown> {
    let response: Response;
    try {
      response = await this.send(`${this.base}${path}`, {
        method, signal: options.signal ?? AbortSignal.timeout(this.timeoutMs), redirect: "error",
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
    if (options.classifyMedia && (status === 400 || status === 422)) {
      const details = record(await response.json().catch(() => null));
      if (isMediaFetchFailure(details.code ?? record(details.error).code)) throw new SocialProviderError("MEDIA_FETCH_FAILED");
    }
    if (status === 401 || status === 403) throw new SocialProviderError("AUTH");
    if (status === 404) throw new SocialProviderError("NOT_FOUND");
    if (status === 412) throw new SocialProviderError("UNSUPPORTED");
    if (status === 409) throw new SocialProviderError("CONFLICT");
    if (status === 429 || status >= 500) {
      const delay = retryAfter(response.headers.get("retry-after"), this.now());
      const retryMs = delay === null || !options.boundedRetryAfter ? delay : Math.min(delay, MAX_BACKOFF_MS);
      throw new SocialProviderError(status === 429 ? "RATE_LIMITED" : "UNAVAILABLE", retryMs);
    }
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
    if (record(body.tokenStatus).valid === false) return { accountRef, health: "failing", code: "token_expired" };
    const health = status === "healthy" || status === "ok" ? "healthy" : status === "warning" || status === "degraded" ? "degraded" : "failing";
    return { accountRef, health, code: health === "healthy" ? null : (safeCode(record(body.health).code ?? body.code)?.toLowerCase() ?? null) };
  }
  async publishPost(cred: SocialCredential, request: PublishRequest): Promise<PublishResult> {
    const { platform, options, draftType, coverUrl } = request;
    const settings: Record<string, unknown> = {};
    if (options?.firstComment !== undefined) settings.firstComment = options.firstComment;
    if (options?.title !== undefined && draftType !== "article") settings.title = options.title;
    if (draftType === "story" || options?.format === "reel") settings.contentType = draftType === "story" ? "story" : "reel";
    if (platform === "twitter" && draftType === "article") {
      settings.article = {
        title: options?.title, content_state: { blocks: request.content.split("\n").map(text => ({ type: "unstyled", text })), entities: [] },
        ...(coverUrl ? { cover: { url: coverUrl } } : {}),
      };
    }
    if (platform === "twitter" && options?.madeWithAi !== undefined) settings.madeWithAi = options.madeWithAi;
    if ((platform === "instagram" || platform === "pinterest") && options?.madeWithAi !== undefined) settings.isAiGenerated = options.madeWithAi;
    if (platform === "youtube" && options?.madeWithAi !== undefined) settings.containsSyntheticMedia = options.madeWithAi;
    if (platform === "instagram") {
      if (options?.coverTimeMs !== undefined) settings.thumbOffset = options.coverTimeMs;
      if (coverUrl) settings.instagramThumbnail = coverUrl;
    }
    if (platform === "pinterest") {
      if (options?.boardId) settings.boardId = options.boardId;
      if (coverUrl) settings.coverImageUrl = coverUrl;
      if (options?.coverTimeMs !== undefined) settings.coverImageKeyFrameTime = options.coverTimeMs / 1000;
      if (options?.linkUrl) settings.link = options.linkUrl;
    }
    if (platform === "reddit") {
      if (options?.subreddit) settings.subreddit = options.subreddit;
      if (options?.linkUrl) settings.url = options.linkUrl;
      if (coverUrl) settings.videoPosterUrl = coverUrl;
    }
    if (platform === "googlebusiness" && options?.linkUrl) settings.callToAction = { type: "LEARN_MORE", url: options.linkUrl };
    if (platform === "discord" && options?.channelId) settings.channelId = options.channelId;
    const tiktok = options?.tiktok ? {
      privacy_level: options.tiktok.privacy, content_preview_confirmed: options.tiktok.confirmedPreview, express_consent_given: options.tiktok.consent,
      ...(options.madeWithAi !== undefined ? { video_made_with_ai: options.madeWithAi } : {}),
      ...(options.coverTimeMs !== undefined ? { video_cover_timestamp_ms: options.coverTimeMs } : {}),
      ...(coverUrl ? { video_cover_image_url: coverUrl } : {}),
      ...(request.media.every(media => media.kind === "image") ? { description: request.content } : {}),
    } : undefined;
    const target = { platform, accountId: request.accountRef, ...(Object.keys(settings).length ? { platformSpecificData: settings } : {}) };
    const mediaItems = request.media.map(media => ({
      type: media.kind, url: media.url, ...(media.altText !== undefined ? { altText: media.altText } : {}),
      ...(media.subtitles?.length ? { subtitles: media.subtitles } : {}),
      ...(media.thumbnailUrl && (platform === "facebook" || platform === "youtube" || platform === "linkedin") ? { thumbnail: media.thumbnailUrl } : {}),
    }));
    const body: Record<string, unknown> = {
      content: draftType === "article" ? "" : request.content, platforms: [target],
      ...(draftType ? { metadata: { harvestDeliveryKey: request.idempotencyKey } } : {}), ...(mediaItems.length ? { mediaItems } : {}), ...(tiktok ? { tiktokSettings: tiktok } : {}),
      ...(request.scheduledFor ? { scheduledFor: request.scheduledFor.toISOString().replace(/\.\d{3}Z$/, ""), timezone: "UTC" } : { publishNow: true }),
    };
    // One key per logical post, sent on every attempt: the provider returns the original for 24 hours, so a retry cannot double-post.
    const parsed = record(await this.call(cred, "POST", "/posts", { body, headers: { "Idempotency-Key": request.idempotencyKey }, idempotent: !draftType, classifyMedia: !!draftType }));
    const post = record(parsed.post), postRef = text(post._id ?? post.id), status = post.status;
    if (!postRef) throw new SocialProviderError("UNAVAILABLE");
    const failed = (Array.isArray(post.platforms) ? post.platforms : []).map(record).some(mediaFetchTarget);
    return { postRef, status: postStatuses.includes(status as ProviderPostStatus) ? status as ProviderPostStatus : "publishing",
      ...(failed ? { errorCategory: "MEDIA_FETCH_FAILED" } : {}) };
  }
  async cancelPost(cred: SocialCredential, postRef: string): Promise<void> { await this.call(cred, "DELETE", `/posts/${enc(postRef)}`, { idempotent: true }); }
  async getPostStatus(cred: SocialCredential, postRef: string): Promise<PostStatusResult> {
    const post = record(record(await this.call(cred, "GET", `/posts/${enc(postRef)}`, { idempotent: true })).post);
    const status = postStatuses.includes(post.status as ProviderPostStatus) ? post.status as ProviderPostStatus : "publishing";
    const failed = (Array.isArray(post.platforms) ? post.platforms : []).map(record).find((p) => text(p.errorCategory ?? p.errorCode));
    return { postRef, status, errorCategory: (Array.isArray(post.platforms) ? post.platforms : []).map(record).some(mediaFetchTarget)
      ? "MEDIA_FETCH_FAILED" : failed ? safeCode(failed.errorCategory ?? failed.errorCode) : null };
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

  private async inboxGet(cred: SocialCredential, path: string, query: { accountRef: string; signal: AbortSignal; cursor?: string; limit?: number }, options: Record<string, string> = {}) {
    const params = new URLSearchParams(this.query(query));
    Object.entries(options).forEach(([name, value]) => params.set(name, value));
    const body = record(await this.once(cred, "GET", `${path}?${params}`, { signal: query.signal }));
    const meta = record(body.meta);
    const failed = (Array.isArray(meta.failedAccounts) ? meta.failedAccounts : []).map(record);
    const failure = failed.find(account => account.accountId === query.accountRef) ?? failed[0];
    if (failure) {
      if (["TOKEN_EXPIRED", "ACCOUNT_DISCONNECTED", "TOKEN_REVOKED"].includes(String(failure.code))) throw new SocialProviderError("EXPIRED");
      if (["X_INBOX_NOT_ENABLED", "PLATFORM_LIMITATION", "SCOPE_MISSING"].includes(String(failure.code))) throw new SocialProviderError("UNSUPPORTED");
      const seconds = failure.retryAfter;
      throw typeof seconds === "number" && seconds >= 0 ? new SocialProviderError("RATE_LIMITED", seconds * 1000) : new SocialProviderError("UNAVAILABLE");
    }
    if (Array.isArray(meta.accountsSkipped) && meta.accountsSkipped.length) throw new SocialProviderError("UNSUPPORTED");
    return body;
  }

  private rows(body: Record<string, unknown>, key: string) {
    if (!Array.isArray(body[key])) throw new SocialProviderError("UNAVAILABLE");
    return body[key].map(record);
  }

  private inboxCursor(body: Record<string, unknown>) {
    const pagination = record(body.pagination);
    const cursor = text(pagination.nextCursor ?? pagination.cursor, 4096);
    if (pagination.hasMore === true && !cursor) throw new SocialProviderError("UNAVAILABLE");
    return cursor;
  }

  private async inboxMentions(cred: SocialCredential, query: { accountRef: string; signal: AbortSignal; cursor?: string; limit: number }) {
    const body = await this.inboxGet(cred, "/inbox/mentions", query);
    return { items: this.rows(body, "data").filter(entry => entry.accountId === query.accountRef), nextCursor: this.inboxCursor(body) };
  }

  async listInbox(cred: SocialCredential, query: InboxListQuery): Promise<Page<InboxEntry>> {
    const { accountRef, kind, platform, search } = query;
    if (kind === "story" || (kind === "mention" && platform === "slack")) {
      // Instagram story replies and Slack bot mentions arrive through message history. Walk both cursors.
      const matches = kind === "story" ? (message: InboxMessage) => message.storyReply : (message: InboxMessage) => message.mentionsBot;
      const progress = query.cursor ? JSON.parse(query.cursor) as { top?: string; ref?: string; next?: string; messages?: string } : {};
      const conversation = progress.ref ? null : await this.listInbox(cred, { ...query, kind: "dm", cursor: progress.top, limit: 1 });
      const entry = conversation?.items[0];
      const ref = progress.ref ?? entry?.ref;
      const next = progress.next ?? conversation?.nextCursor ?? undefined;
      if (!ref) return { items: [], nextCursor: next ? JSON.stringify({ top: next }) : null };
      const page = await this.readInbox(cred, { ...query, ref, cursor: progress.messages, limit: 10 });
      const match = page.items.find(message => matches(message) && message.direction === "incoming");
      return {
        items: match ? [{ accountRef, kind, ref, title: page.title ?? null, preview: match.text, activityAt: match.at }] : [],
        nextCursor: !match && page.nextCursor ? JSON.stringify({ ref, next, messages: page.nextCursor }) : next ? JSON.stringify({ top: next }) : null,
      };
    }
    let rows: Record<string, unknown>[], nextCursor: string | null;
    if (kind === "mention") {
      const page = await this.inboxMentions(cred, query);
      rows = page.items;
      nextCursor = page.nextCursor;
    } else {
      const path = kind === "comment" ? "/inbox/comments" : search ? "/inbox/conversations/search" : "/inbox/conversations";
      const options: Record<string, string> = search ? { query: search, platform } : kind === "comment" ? { view: "summary", minComments: "1", platform } : {};
      const body = await this.inboxGet(cred, path, query, options);
      rows = this.rows(body, "data").map(row => search ? record(row.conversation) : row);
      nextCursor = this.inboxCursor(body);
    }
    const items = rows.flatMap((row): InboxEntry[] => {
      const ref = text(row.id);
      if (!ref || row.accountId !== accountRef || row.platform !== platform) return [];
      return [{ kind, accountRef, ref, title: text(row.participantName ?? row.authorName, 200),
        preview: text(row.lastMessage ?? row.content, 500), activityAt: date(row.updatedAt ?? row.updatedTime ?? row.publishedAt ?? row.createdTime ?? row.createdAt) }];
    });
    return { items, nextCursor };
  }

  async readInbox(cred: SocialCredential, query: InboxItemQuery): Promise<InboxReadPage> {
    const { accountRef, ref, kind } = query;
    if (kind === "mention" && query.platform !== "slack") {
      const page = await this.inboxMentions(cred, query);
      const match = page.items.find(item => item.id === ref && item.platform === query.platform);
      if (!match && !page.nextCursor) throw new SocialProviderError("NOT_FOUND");
      // Some providers expose a paged list only. Continue the live lookup by returning its next cursor.
      return { items: match ? [{ ref, direction: "incoming", text: text(match.content, 10_000),
        at: date(match.publishedAt ?? match.createdAt), attachments: [], canReply: query.platform === "instagram" }] : [],
        title: text(match?.authorName ?? match?.authorUsername), nextCursor: match ? null : page.nextCursor };
    }
    if (kind === "comment") {
      const body = await this.inboxGet(cred, `/inbox/comments/${enc(ref)}`, query);
      const rows = this.rows(body, "comments");
      return { items: rows.flatMap(row => inboxComment(row)), nextCursor: this.inboxCursor(body) };
    }
    const path = `/inbox/conversations/${enc(ref)}`;
    // The detail read supplies account ownership even for an empty message page.
    const detail = record((await this.inboxGet(cred, path, { accountRef, signal: query.signal })).data);
    if (detail.id !== ref || detail.accountId !== accountRef || detail.platform !== query.platform) throw new SocialProviderError("NOT_FOUND");
    const body = await this.inboxGet(cred, `${path}/messages`, query, { sortOrder: "desc" });
    const items = this.rows(body, "messages").flatMap(row => {
      if ((row.accountId !== undefined && row.accountId !== accountRef) || (row.platform !== undefined && row.platform !== query.platform)) return [];
      return inboxMessage(row);
    });
    return { items, nextCursor: this.inboxCursor(body), title: text(detail.participantName) };
  }

  async inboxReplyEligibility(cred: SocialCredential, query: InboxReplyQuery): Promise<InboxReplyEligibility> {
    const { platform, accountRef, mode, ref, targetRef, signal } = query;
    const capabilities = inboxCapabilities(platform);
    const feature = { message: capabilities.messageReply, comment: capabilities.commentReply,
      private: capabilities.privateReply, mention: capabilities.mentionReply }[mode];
    if (feature === "unavailable") return { allowed: false, reason: "unavailable" };
    const health = record(await this.once(cred, "GET", `/accounts/${enc(accountRef)}/health`, { signal }));
    const token = record(health.tokenStatus), permissions = record(health.permissions), areas = record(permissions.scopeAreas);
    if (health.accountId !== accountRef || health.platform !== platform || health.status === "error" || token.valid !== true || health.messagingRestriction)
      return { allowed: false, reason: "unhealthy" };
    const scopes = [permissions.posting, permissions.optional].flatMap(group => Array.isArray(group) ? group.map(record) : []);
    const granted = (scope: string) => scopes.some(entry => entry.scope === scope && entry.granted === true);
    const allowedArea = (area: "messaging" | "comments") => areas[area] === "granted" ||
      (areas[area] === undefined && (inboxWriteScopes[platform]?.[area] ?? []).some(granted));
    const messageMode = mode === "message" || (mode === "mention" && platform === "slack");
    if (!(messageMode ? allowedArea("messaging") : allowedArea("comments")) || (mode === "private" && !allowedArea("messaging")))
      return { allowed: false, reason: "permissions" };

    if (mode === "mention" && platform !== "slack") {
      let cursor: string | undefined;
      for (let page = 0; page < 4; page++) {
        const { items, nextCursor } = await this.inboxMentions(cred, { accountRef, signal, cursor, limit: 100 });
        const match = items.find(item => item.id === ref && item.platform === platform);
        if (match) {
          const mediaRef = text(match.mediaId), commentRef = text(match.commentId);
          return mediaRef && targetRef === commentRef ? { allowed: true, expiresAt: null, media: false, quote: false, mediaRef } :
            { allowed: false, reason: "target_unavailable" };
        }
        if (!nextCursor) break;
        cursor = nextCursor;
      }
      return { allowed: false, reason: "target_unavailable" };
    }
    if (!messageMode) {
      const body = await this.inboxGet(cred, `/inbox/comments/${enc(ref)}`, { accountRef, signal, limit: 100 });
      const target = this.rows(body, "comments").flatMap(row => [row, ...(Array.isArray(row.replies) ? row.replies.map(record) : [])]).find(row => row.id === targetRef);
      if (!target || target.canReply !== true) return { allowed: false, reason: "target_unavailable" };
      if (mode === "comment") return { allowed: true, expiresAt: null, media: capabilities.commentMedia !== "unavailable", quote: false };
      const at = date(target.createdTime);
      if (!at || target.isPrivateReplyEligible === false) return { allowed: false, reason: "target_unavailable" };
      return this.inboxWindow(at, 168, false, false);
    }

    const { items } = await this.readInbox(cred, { ...query, limit: 100 });
    if ((mode === "mention" && (!targetRef || !items.some(message => message.ref === targetRef && message.mentionsBot && !message.deleted)))
      || (targetRef && !items.some(message => message.ref === targetRef && !message.deleted)))
      return { allowed: false, reason: "target_unavailable" };
    const lastInbound = items.filter(message => message.direction === "incoming" && !message.deleted && message.at)
      .reduce<Date | null>((latest, item) => !latest || item.at! > latest ? item.at : latest, null);
    const media = capabilities.messageMedia !== "unavailable", quote = capabilities.quoteReply !== "unavailable";
    if (!lastInbound) return { allowed: false, reason: "target_unavailable" };
    if (platform === "instagram" || platform === "facebook") {
      const agent = this.now().getTime() >= lastInbound.getTime() + 86_400_000;
      const eligibility = this.inboxWindow(lastInbound, agent ? 168 : 24, media, quote);
      return eligibility.allowed ? { ...eligibility, humanAgent: agent } : eligibility;
    }
    if (platform === "whatsapp" || platform === "wechat" || platform === "tiktok") {
      return this.inboxWindow(lastInbound, platform === "whatsapp" ? 24 : 48, media, quote);
    }
    return { allowed: true, expiresAt: null, media, quote };
  }

  private inboxWindow(at: Date, hours: number, media: boolean, quote: boolean): InboxReplyEligibility {
    const expiresAt = new Date(at.getTime() + hours * 3_600_000);
    return expiresAt > this.now() ? { allowed: true, expiresAt, media, quote } : { allowed: false, reason: "expired_window" };
  }

  async dispatchInboxReply(cred: SocialCredential, request: InboxReplyRequest): Promise<SendResult> {
    const { accountRef, ref, text: reply, attachment, targetRef, mode } = request;
    const body: Record<string, unknown> = { accountId: accountRef, message: reply || undefined };
    if (attachment) {
      body.attachmentUrl = attachment.url;
      if (mode === "message") body.attachmentType = attachment.type;
    }
    let path = `/inbox/comments/${enc(ref)}`;
    if (mode === "message" || (mode === "mention" && request.platform === "slack")) {
      path = `/inbox/conversations/${enc(ref)}/messages`;
      if (targetRef) body.replyTo = targetRef;
      if (request.humanAgent) Object.assign(body, { messageTag: "HUMAN_AGENT", messagingType: "MESSAGE_TAG" });
    } else if (mode === "private") {
      if (!targetRef) throw new SocialProviderError("INVALID_REQUEST");
      path += `/${enc(targetRef)}/private-reply`;
    } else if (mode === "mention") {
      if (!request.mediaRef) throw new SocialProviderError("INVALID_REQUEST");
      path = "/inbox/mentions/reply";
      body.mediaId = request.mediaRef;
      body.commentId = targetRef ?? undefined;
    } else {
      body.commentId = targetRef ?? undefined;
    }
    const headers = mode === "message" || mode === "comment" || (mode === "mention" && request.platform === "slack") ? { "Idempotency-Key": request.idempotencyKey } : undefined;
    const response = record(await this.once(cred, "POST", path, { body, headers }));
    const responseData = record(response.data), comment = record(response.comment);
    const sent = text(responseData.messageId ?? responseData.commentId ?? responseData.id ?? response.messageId ?? response.commentId ?? comment.id);
    if (sent) return { ref: sent };
    // Some successful sends (e.g. Reddit) intentionally return no provider reference.
    if (response.success === true) return { ref: request.idempotencyKey };
    throw new SocialProviderError("UNAVAILABLE");
  }

  async reconcileInboxReply(): Promise<SendResult | null> {
    // No documented read or event carries the client key back. Matching by message content/time would misattribute other human activity.
    return null;
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
      "message.sent": "message.sent", "message.failed": "message.failed", "comment.received": "comment.received", "mention.received": "mention.received" };
    const kind = map[name] ?? "other", post = record(b.post), account = record(b.account), message = record(b.message), comment = record(b.comment), mention = record(b.mention);
    const firstTarget = record((Array.isArray(post.platforms) ? post.platforms : [])[0]);
    const failed = (Array.isArray(post.platforms) ? post.platforms : []).map(record).find((p) => text(p.errorCategory));
    const correlationKey = record(post.metadata).harvestDeliveryKey;
    const platform = [account.platform, message.platform, firstTarget.platform].find(isPlatform) ?? null;
    // Only identifiers leave this function. Message and comment text, sender names and similar content are dropped here.
    return {
      eventId, kind, rawType: kind === "other" ? safeCode(name) ?? "" : "",
      accountRef: text(account.accountId ?? account.id) ?? text(firstTarget.accountId),
      subjectRef: kind.startsWith("post.") ? text(post.id ?? post._id) : kind.startsWith("message.") ? text(message.conversationId) : kind === "comment.received" ? text(comment.postId ?? comment.platformPostId ?? comment.id) : kind === "mention.received" ? text(mention.id) : null,
      platform, errorCategory: failed && mediaFetchTarget(failed) ? "MEDIA_FETCH_FAILED" : failed ? safeCode(failed.errorCategory) : null, occurredAt,
      ...(kind.startsWith("post.") && deliveryKey(correlationKey) ? { correlationKey } : {}),
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

const inboxWriteScopes: Partial<Record<SocialPlatform, { messaging?: string[]; comments?: string[] }>> = {
  instagram: { messaging: ["instagram_business_manage_messages", "instagram_manage_messages"], comments: ["instagram_business_manage_comments", "instagram_manage_comments"] },
  facebook: { messaging: ["pages_messaging"], comments: ["pages_manage_engagement"] },
  twitter: { messaging: ["dm.write"], comments: ["tweet.write"] },
  threads: { comments: ["threads_manage_replies"] },
  linkedin: { comments: ["w_organization_social_feed", "w_member_social_feed"] },
  tiktok: { messaging: ["message.list.send"], comments: ["comment.list.manage"] },
  youtube: { comments: ["youtube.force-ssl"] },
  reddit: { messaging: ["privatemessages"], comments: ["submit"] },
  slack: { messaging: ["chat:write"] },
  whatsapp: { messaging: ["whatsapp_business_messaging"] },
};

function inboxComment(row: Record<string, unknown>): InboxMessage[] {
  const ref = text(row.id);
  if (!ref) return [];
  const message: InboxMessage = { ref, direction: row.isOwn === true ? "outgoing" : "unknown",
    text: text(row.message ?? row.text, 10_000), at: date(row.createdTime ?? row.createdAt), attachments: [],
    canReply: row.canReply === true, canPrivateReply: row.isPrivateReplyEligible !== false && row.isOwn !== true };
  return [message, ...(Array.isArray(row.replies) ? row.replies.map(record).flatMap(inboxComment) : [])];
}

function inboxMessage(row: Record<string, unknown>): InboxMessage[] {
  const ref = text(row.id);
  if (!ref) return [];
  const story = record(row.storyReply), storyRef = text(story.storyId);
  const direction = row.direction === "incoming" || row.direction === "outgoing" ? row.direction : "unknown";
  const deleted = row.isDeleted === true;
  const attachments = deleted || !Array.isArray(row.attachments) ? [] : row.attachments.slice(0, 20).map(record).map(attachment => ({
    type: text(attachment.type, 60) ?? "file", url: httpsUrl(attachment.url), name: text(attachment.filename),
  }));
  const status = row.deliveryStatus;
  const deliveryStatus = status === "sent" || status === "delivered" || status === "read" || status === "played" || status === "failed" || status === "deleted" ? status : undefined;
  return [{ ref, direction, deleted, text: deleted ? null : text(row.message, 10_000),
    at: date(row.createdAt ?? row.sentAt ?? row.timestamp), attachments, storyReply: !!storyRef,
    storyMention: row.isStoryMention === true, mentionsBot: record(row.metadata).mentionsBot === true,
    canReply: record(row.metadata).mentionsBot === true && !deleted, deliveryStatus, replyTo: text(record(row.metadata).quotedMessageId) ?? undefined,
    ...(storyRef && !deleted ? { story: { ref: storyRef, url: httpsUrl(story.storyUrl) } } : {}),
  }];
}

function httpsUrl(value: unknown): string | null {
  const url = text(value, 4_096);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? url : null;
  } catch { return null; }
}

function mediaFetchTarget(target: Record<string, unknown>) {
  if (isMediaFetchFailure(target.errorCategory ?? target.errorCode)) return true;
  const detail = text(target.errorMessage, 500);
  return !!detail && /^(?:media (?:fetch failed|download has failed)|unable to fetch video file from url|cannot process video from this url|tiktok video upload failed: your video url returned an error)/i.test(detail);
}
