import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialProviderError } from "../../src/server/social/port";
import { ZERNIO_BASE_URL, ZERNIO_LIVE_NETWORK, ZernioAdapter } from "../../src/server/social/zernio-adapter";
import { ZERNIO_TEST_KEY, jsonResponse, zernioDouble } from "../social-fixtures";

afterEach(() => vi.restoreAllMocks());
const cred = { secret: ZERNIO_TEST_KEY };
const setup = (options: ConstructorParameters<typeof ZernioAdapter>[0] = {}) => {
  const double = zernioDouble(), sleeps: number[] = [];
  return { double, sleeps, adapter: new ZernioAdapter({ fetch: double.fetch, sleep: async (ms) => { sleeps.push(ms); }, ...options }) };
};
const code = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { expect(error).toBeInstanceOf(SocialProviderError); return (error as SocialProviderError).code; } return null; };
const request = { idempotencyKey: "0a1b2c3d-1111-4222-8333-444455556666", accountRef: "acc-ig-1", platform: "instagram" as const, content: "Sunday at 10", media: [{ kind: "image" as const, url: "https://files.example.org/a.jpg" }] };

describe("hard disable", () => {
  it("is a constant, and false", () => { expect(ZERNIO_LIVE_NETWORK).toBe(false); });
  it("makes zero network calls and throws DISABLED when no fetch is injected", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const adapter = new ZernioAdapter();
    for (const call of [() => adapter.listAccounts(cred), () => adapter.getAccountHealth(cred, "a"), () => adapter.publishPost(cred, request), () => adapter.cancelPost(cred, "p"),
      () => adapter.getPostStatus(cred, "p"), () => adapter.listConversations(cred, { accountRef: "a" }), () => adapter.listMessages(cred, { accountRef: "a", conversationRef: "c" }),
      () => adapter.listComments(cred, { accountRef: "a", postRef: "p" }), () => adapter.sendMessage(cred, { idempotencyKey: "k", accountRef: "a", conversationRef: "c", text: "x" }),
      () => adapter.replyToComment(cred, { idempotencyKey: "k", accountRef: "a", postRef: "p", commentRef: "c", text: "x" })]) expect(await code(call())).toBe("DISABLED");
    expect(spy).not.toHaveBeenCalled();
  });
  it("does not retry a disabled call", async () => {
    const sleeps: number[] = [];
    expect(await code(new ZernioAdapter({ sleep: async (ms) => { sleeps.push(ms); } }).listAccounts(cred))).toBe("DISABLED");
    expect(sleeps).toEqual([]);
  });
});

describe("request shapes", () => {
  it("publishes now with bearer auth, the idempotency header and the documented body", async () => {
    const { adapter, double } = setup();
    const result = await adapter.publishPost(cred, request);
    expect(result).toEqual({ postRef: "post-1", status: "published" });
    const [sent] = double.requests;
    expect(sent.url).toBe(`${ZERNIO_BASE_URL}/posts`); expect(sent.method).toBe("POST");
    expect(sent.headers).toMatchObject({ authorization: `Bearer ${ZERNIO_TEST_KEY}`, "idempotency-key": request.idempotencyKey, "content-type": "application/json" });
    expect(sent.body).toEqual({ content: "Sunday at 10", platforms: [{ platform: "instagram", accountId: "acc-ig-1" }], mediaItems: [{ type: "image", url: "https://files.example.org/a.jpg" }], publishNow: true });
  });
  it("sends a scheduled time in UTC instead of publishNow", async () => {
    const { adapter, double } = setup();
    await adapter.publishPost(cred, { ...request, media: [], scheduledFor: new Date("2027-01-01T12:00:00.000Z") });
    expect(double.requests[0].body).toEqual({ content: "Sunday at 10", platforms: [{ platform: "instagram", accountId: "acc-ig-1" }], scheduledFor: "2027-01-01T12:00:00", timezone: "UTC" });
  });
  it("uses the documented paths and encodes identifiers", async () => {
    const { adapter, double } = setup();
    await adapter.listAccounts(cred); await adapter.getAccountHealth(cred, "acc-ig-1"); await adapter.getPostStatus(cred, "post-1").catch(() => {});
    await adapter.listConversations(cred, { accountRef: "acc-ig-1", limit: 500, cursor: "2" }); await adapter.listMessages(cred, { accountRef: "acc-ig-1", conversationRef: "conv 1/x" });
    await adapter.listComments(cred, { accountRef: "acc-ig-1", postRef: "post-1" });
    expect(double.requests.map((r) => `${r.method} ${r.url.replace(ZERNIO_BASE_URL, "")}`)).toEqual([
      "GET /accounts", "GET /accounts/acc-ig-1/health", "GET /posts/post-1",
      "GET /inbox/conversations?accountId=acc-ig-1&limit=100&cursor=2", "GET /inbox/conversations/conv%201%2Fx/messages?accountId=acc-ig-1&limit=25", "GET /inbox/comments/post-1?accountId=acc-ig-1&limit=25"]);
  });
  it("sends replies with the documented bodies (port signature only; nothing calls this)", async () => {
    const { adapter, double } = setup();
    expect(await adapter.sendMessage(cred, { idempotencyKey: "k", accountRef: "acc-ig-1", conversationRef: "conv-1", text: "hello" })).toEqual({ ref: "sent-1" });
    expect(await adapter.replyToComment(cred, { idempotencyKey: "k", accountRef: "acc-ig-1", postRef: "post-1", commentRef: "cm-1", text: "thanks" })).toEqual({ ref: "reply-1" });
    expect(double.requests.map((r) => [r.method, r.url.replace(ZERNIO_BASE_URL, ""), r.body])).toEqual([
      ["POST", "/inbox/conversations/conv-1/messages", { accountId: "acc-ig-1", message: "hello" }], ["POST", "/inbox/comments/post-1", { accountId: "acc-ig-1", commentId: "cm-1", message: "thanks" }]]);
  });
});

describe("error mapping", () => {
  it.each([[401, "AUTH"], [403, "AUTH"], [404, "NOT_FOUND"], [409, "CONFLICT"], [400, "INVALID_REQUEST"], [422, "INVALID_REQUEST"], [429, "RATE_LIMITED"], [500, "UNAVAILABLE"], [503, "UNAVAILABLE"]])("maps HTTP %i to %s", async (status, expected) => {
    const { adapter, double } = setup({ maxAttempts: 1 });
    double.script(jsonResponse(status, { error: `echo ${ZERNIO_TEST_KEY} and PRIVATE CONTENT`, type: "x" }));
    const error = await adapter.listAccounts(cred).catch((e) => e);
    expect(error).toBeInstanceOf(SocialProviderError); expect(error.code).toBe(expected);
    // The provider's body, our token and request content never reach the error.
    expect(`${error.message} ${JSON.stringify(error)} ${error.stack}`).not.toMatch(/PRIVATE CONTENT|zernio-test-key|echo/);
  });
  it("treats a network failure, a timeout and an unreadable success body as UNAVAILABLE", async () => {
    for (const script of [new TypeError("fetch failed"), new DOMException("timeout", "TimeoutError"), new Response("<html>", { status: 200 })]) {
      const { adapter, double } = setup({ maxAttempts: 1 });
      double.script(script);
      expect(await code(adapter.listAccounts(cred))).toBe("UNAVAILABLE");
    }
  });
});

describe("retries and idempotency", () => {
  it("retries a transient failure with exponential backoff and succeeds", async () => {
    const { adapter, double, sleeps } = setup();
    double.script(jsonResponse(503, {}), jsonResponse(502, {}));
    expect((await adapter.listAccounts(cred)).length).toBe(1);
    expect(double.requests).toHaveLength(3); expect(sleeps).toEqual([500, 1000]);
  });
  it("honours Retry-After on 429, bounded", async () => {
    const { adapter, double, sleeps } = setup();
    double.script(jsonResponse(429, {}, { "retry-after": "2" }), jsonResponse(429, {}, { "retry-after": "99999" }));
    await adapter.listAccounts(cred);
    expect(sleeps).toEqual([2000, 30_000]);
  });
  it("gives up after the attempt cap with the last error and does not retry permanent errors", async () => {
    const a = setup({ maxAttempts: 3 });
    a.double.script(jsonResponse(500, {}), jsonResponse(500, {}), jsonResponse(500, {}));
    expect(await code(a.adapter.listAccounts(cred))).toBe("UNAVAILABLE"); expect(a.double.requests).toHaveLength(3);
    const b = setup();
    b.double.script(jsonResponse(400, {}));
    expect(await code(b.adapter.listAccounts(cred))).toBe("INVALID_REQUEST"); expect(b.double.requests).toHaveLength(1);
  });
  it("resends the SAME idempotency key on every publish retry, so a retry cannot double-post", async () => {
    const { adapter, double } = setup();
    double.script(jsonResponse(503, {}), new TypeError("fetch failed"));
    const result = await adapter.publishPost(cred, request);
    expect(double.requests.map((r) => r.headers["idempotency-key"])).toEqual([request.idempotencyKey, request.idempotencyKey, request.idempotencyKey]);
    expect(double.posts.size).toBe(1); expect(result.postRef).toBe("post-1");
  });
  it("never retries a message send: it has no idempotency key, so a retry could message a person twice", async () => {
    const { adapter, double } = setup();
    double.script(jsonResponse(503, {}));
    expect(await code(adapter.sendMessage(cred, { idempotencyKey: "k", accountRef: "acc-ig-1", conversationRef: "conv-1", text: "x" }))).toBe("UNAVAILABLE");
    expect(double.requests).toHaveLength(1);
    double.script(jsonResponse(503, {}));
    expect(await code(adapter.replyToComment(cred, { idempotencyKey: "k", accountRef: "acc-ig-1", postRef: "p", commentRef: "c", text: "x" }))).toBe("UNAVAILABLE");
    expect(double.requests).toHaveLength(2);
  });
  it("maps a 409 duplicate-content answer to CONFLICT rather than treating it as published", async () => {
    const { adapter, double } = setup();
    double.script(jsonResponse(409, { error: "This exact content is already scheduled", details: { existingPostId: "old" } }));
    expect(await code(adapter.publishPost(cred, request))).toBe("CONFLICT");
  });
});

describe("webhook event details", () => {
  it("takes the account from the post target when the event has no account object, and drops error text", () => {
    const adapter = new ZernioAdapter();
    const event = adapter.parseWebhookEvent(JSON.stringify({ id: "e1", event: "post.failed", timestamp: "2026-11-09T10:05:00Z", post: { id: "p1", platforms: [{ platform: "tiktok", accountId: "acc-9", errorCategory: "Rate Limit!", errorMessage: "LEAK" }] } }))!;
    expect(event).toMatchObject({ accountRef: "acc-9", subjectRef: "p1", platform: "tiktok", errorCategory: "Rate_Limit_" });
    expect(JSON.stringify(event)).not.toContain("LEAK");
  });
  it("falls back to receipt time when the delivery carries no timestamp", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    expect(new ZernioAdapter({ now: () => now }).parseWebhookEvent(JSON.stringify({ id: "e2", event: "account.disconnected", account: { accountId: "a" } }))!.occurredAt).toEqual(now);
  });
});
