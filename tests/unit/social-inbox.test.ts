import { expect, it, vi } from "vitest";
import { inboxCapabilities, socialPlatforms } from "../../src/lib/social/platforms";
import { renderSavedReply, savedReplyVariables } from "../../src/server/social/inbox-metadata";
import { createReplyHandoff } from "../../src/server/social/inbox-reply-handoff";
import { SOCIAL_HUMAN_REPLY_ENABLED } from "../../src/server/social/inbox-reply";
import { ZernioAdapter } from "../../src/server/social/zernio-adapter";
import { runSocialUploadCleanupWorker } from "../../src/server/social/social-upload-cleanup";

vi.mock("server-only", () => ({}));
const signal = new AbortController().signal;
const credential = { secret: "mock-fixture-key" };
const base = { accountRef: "account", platform: "instagram" as const, signal, limit: 10 };
const participant = { id: "conversation", accountId: "account", platform: "instagram", participantName: "Temporary name" };
const message = { id: "message", accountId: "account", platform: "instagram", direction: "incoming", message: "Live body",
  createdAt: "2026-11-20T04:00:00Z", storyReply: { storyId: "story-1", storyUrl: "https://fixture.invalid/story" } };

it.each(socialPlatforms)("returns the full capability shape for %s", platform => {
  const caps = inboxCapabilities(platform);
  expect(Object.keys(caps)).toEqual(["conversationRead", "messageReply", "commentRead", "commentReply", "privateReply",
    "messageMedia", "commentMedia", "mentions", "mentionReply", "storyReplies", "liveSearch", "quoteReply"]);
  const conversation = ["twitter", "instagram", "facebook", "tiktok", "reddit", "bluesky", "telegram", "slack", "whatsapp", "rcs", "imessage", "line", "wechat", "sms"];
  const comments = ["twitter", "instagram", "facebook", "linkedin", "tiktok", "youtube", "reddit", "bluesky", "threads"];
  expect(caps.conversationRead !== "unavailable").toBe(conversation.includes(platform));
  expect(caps.commentRead !== "unavailable").toBe(comments.includes(platform));
  expect(caps.privateReply !== "unavailable").toBe(["facebook", "instagram"].includes(platform));
  expect(caps.mentions !== "unavailable").toBe(["facebook", "instagram", "linkedin", "slack"].includes(platform));
  if (platform === "bluesky" || platform === "reddit") expect(caps.messageMedia).toBe("unavailable");
  expect(caps.storyReplies !== "unavailable").toBe(platform === "instagram");
});

it("walks Instagram story reply message history with an account-scoped document", async () => {
  const paths: string[] = [];
  const adapter = new ZernioAdapter({ fetch: async url => {
    const parsed = new URL(url);
    paths.push(parsed.pathname);
    expect(parsed.searchParams.get("accountId")).toBe("account");
    if (parsed.pathname.endsWith("/conversations")) return Response.json({ data: [participant], pagination: { nextCursor: null, hasMore: false } });
    if (parsed.pathname.endsWith("/messages")) return Response.json({ messages: [message], pagination: { nextCursor: null } });
    return Response.json({ data: participant });
  } });
  expect(await adapter.listInbox(credential, { ...base, kind: "story" })).toEqual({
    items: [{ ref: "conversation", kind: "story", accountRef: "account", title: "Temporary name", preview: "Live body", activityAt: new Date(message.createdAt) }],
    nextCursor: null,
  });
  expect(paths).toEqual(["/api/v1/inbox/conversations", "/api/v1/inbox/conversations/conversation", "/api/v1/inbox/conversations/conversation/messages"]);
});

it("preserves provider backoff, token expiry and unsupported status for an account", async () => {
  const request = vi.fn();
  const adapter = new ZernioAdapter({ fetch: request });
  request.mockResolvedValueOnce(Response.json({ data: [], meta: { failedAccounts: [{ accountId: "account", code: "TOKEN_EXPIRED" }] } }));
  await expect(adapter.listInbox(credential, { ...base, kind: "dm" })).rejects.toMatchObject({ code: "EXPIRED" });
  request.mockResolvedValueOnce(Response.json({ data: [], meta: { accountsSkipped: [{ accountId: "account" }] } }));
  await expect(adapter.listInbox(credential, { ...base, kind: "comment" })).rejects.toMatchObject({ code: "UNSUPPORTED" });
  request.mockResolvedValueOnce(Response.json({ data: [], meta: { failedAccounts: [{ accountId: "account", retryAfter: 73 }] } }));
  await expect(adapter.listInbox(credential, { ...base, kind: "dm" })).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 73_000 });
  expect(request).toHaveBeenCalledTimes(3);
});

it("uses only scoped live search matches without retaining body or provider state", async () => {
  const adapter = new ZernioAdapter({ fetch: async url => {
    const endpoint = new URL(url);
    expect(endpoint.pathname.endsWith("/inbox/conversations/search")).toBe(true);
    expect(endpoint.searchParams.get("query")).toBe("search phrase");
    return Response.json({ data: [{ conversation: participant }, { conversation: { ...participant, accountId: "foreign" } }],
      pagination: { nextCursor: "opaque-next" } });
  } });
  expect(await adapter.listInbox(credential, { ...base, kind: "dm", search: "search phrase" })).toMatchObject({
    items: [{ ref: "conversation", accountRef: "account" }], nextCursor: "opaque-next",
  });
});

it("checks actual scope and window before an Instagram text reply", async () => {
  let granted = false, now = new Date("2026-11-22T04:00:00Z");
  const adapter = new ZernioAdapter({ now: () => now, fetch: async url => {
    if (url.endsWith("/health")) return Response.json({ accountId: "account", platform: "instagram", status: "healthy", tokenStatus: { valid: true },
      permissions: { scopeAreas: { messaging: granted ? "granted" : "missing" } } });
    if (new URL(url).pathname.endsWith("/messages")) return Response.json({ messages: [message] });
    return Response.json({ data: participant });
  } });
  const query = { ...base, kind: "dm" as const, ref: "conversation", mode: "message" as const, targetRef: null };
  expect(await adapter.inboxReplyEligibility(credential, query)).toEqual({ allowed: false, reason: "permissions" });
  granted = true;
  expect(await adapter.inboxReplyEligibility(credential, query)).toMatchObject({ allowed: true, humanAgent: true, expiresAt: new Date("2026-11-27T04:00:00Z") });
  now = new Date("2026-11-28T04:00:00Z");
  expect(await adapter.inboxReplyEligibility(credential, query)).toEqual({ allowed: false, reason: "expired_window" });
});

it("parses and renders declared variables exactly once", () => {
  expect(savedReplyVariables("Hi {{name}}, {{name}} {{code}}")).toEqual(["name", "code"]);
  expect(renderSavedReply("Hi {{name}}, {{code}}", { name: "{{code}}", code: "$&" })).toBe("Hi {{code}}, $&");
  expect(() => renderSavedReply("Hi {{name}}", { name: "Sam", extra: "no" })).toThrow();
});

it("expires memory-only reply material and keeps the runtime sender off", () => {
  let instant = 0;
  const handoff = createReplyHandoff(() => instant);
  const reply = { tenantId: "tenant", id: "job", itemId: "item", mode: "message" as const, targetRef: null, fileId: null, text: "ephemeral" };
  expect(SOCIAL_HUMAN_REPLY_ENABLED).toBe(false);
  expect(handoff.offer(reply)).toBe(true);
  expect(handoff.available()).toEqual(["tenant:job"]);
  instant += 15 * 60_000;
  expect(handoff.read("tenant:job")).toBeUndefined();
});

it("refuses production and default-off cleanup before creating database or storage clients", async () => {
  const pool = vi.fn(), storage = vi.fn(), output = { log: vi.fn(), error: vi.fn() };
  expect(await runSocialUploadCleanupWorker("run", { NODE_ENV: "production", HARVEST_SOCIAL_UPLOAD_CLEANUP_ENABLED: "1" }, pool, storage, output)).toBe(0);
  expect(await runSocialUploadCleanupWorker("run", { NODE_ENV: "test" }, pool, storage, output)).toBe(0);
  expect(pool).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled();
});

it("reads Slack bot mentions through message history and threads a human reply", async () => {
  const platform = "slack" as const;
  const requests: { path: string; body: string | null; key: string | null }[] = [];
  const adapter = new ZernioAdapter({ fetch: async (url, request) => {
    const path = new URL(url).pathname;
    requests.push({ path, body: typeof request.body === "string" ? request.body : null, key: new Headers(request.headers).get("Idempotency-Key") });
    if (request.method === "POST") return Response.json({ success: true, data: { messageId: "outbound" } });
    if (path.endsWith("/conversations")) return Response.json({ data: [{ ...participant, platform }] });
    if (path.endsWith("/messages")) return Response.json({ messages: [{ ...message, platform, metadata: { mentionsBot: true } }] });
    if (path.endsWith("/health")) return Response.json({ accountId: "account", platform, status: "healthy", tokenStatus: { valid: true },
      permissions: { scopeAreas: { messaging: "granted" } } });
    return Response.json({ data: { ...participant, platform } });
  } });
  const query = { ...base, platform, kind: "mention" as const, ref: "conversation", mode: "mention" as const, targetRef: "message" };
  expect(await adapter.listInbox(credential, query)).toMatchObject({ items: [{ kind: "mention", ref: "conversation" }] });
  expect(await adapter.inboxReplyEligibility(credential, query)).toMatchObject({ allowed: true, quote: true });
  expect(await adapter.dispatchInboxReply(credential, { ...query, idempotencyKey: "test-key", text: "Fixture text" })).toEqual({ ref: "outbound" });
  expect(requests.at(-1)).toEqual({ path: "/api/v1/inbox/conversations/conversation/messages",
    body: JSON.stringify({ accountId: "account", message: "Fixture text", replyTo: "message" }), key: "test-key" });
});

it("maps a documented terminal media-fetch failure to a fixed outcome", async () => {
  const adapter = new ZernioAdapter({ fetch: async () => Response.json({ post: { _id: "post-1", status: "failed",
    platforms: [{ platform: "instagram", status: "failed", errorMessage: "Media fetch failed, retrying... (failed after 3 attempts)" }] } }, { status: 207 }) });
  expect(await adapter.publishPost(credential, { accountRef: "account", platform: "instagram", draftType: "post",
    idempotencyKey: "test-key", content: "Fixture", media: [] })).toEqual({ postRef: "post-1", status: "failed", errorCategory: "MEDIA_FETCH_FAILED" });
});
