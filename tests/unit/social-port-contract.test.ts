import { describe, expect, it } from "vitest";
import { SocialProviderError, type SocialProvider } from "../../src/server/social/port";
import { FakeProvider } from "../../src/server/social/fake-provider";
import { ZernioAdapter } from "../../src/server/social/zernio-adapter";
import type { SocialCredential } from "../../src/server/social/types";
import { WEBHOOK_SECRET, ZERNIO_TEST_KEY, sign, zernioDouble, zernioEvents } from "../social-fixtures";

// One contract, two implementations: the in-memory fake and the vendor adapter driven through an in-memory HTTP double.
type Harness = { name: string; provider: SocialProvider; cred: SocialCredential; accountRef: string; platform: "instagram"; events: { published: () => { raw: string; sig: string }; message: () => { raw: string; sig: string }; unknown: () => { raw: string; sig: string }; failed: () => { raw: string; sig: string } } };
const fakeEvent = (type: string, extra: Record<string, unknown> = {}) => { const raw = JSON.stringify({ id: `evt-${type}`, type, timestamp: new Date().toISOString(), accountRef: "acc-ig-1", subjectRef: "post-1", platform: "instagram", ...extra }); return { raw, sig: sign(raw) }; };
const zEvent = (raw: string) => ({ raw, sig: sign(raw) });
function fake(): Harness {
  const provider = new FakeProvider({ validSecret: ZERNIO_TEST_KEY, accounts: [{ accountRef: "acc-ig-1", platform: "instagram", displayName: "grace_church" }],
    conversations: [1, 2, 3].map((n) => ({ conversationRef: `conv-${n}`, accountRef: "acc-ig-1", platform: "instagram" as const, participantName: `P${n}`, lastMessagePreview: "hi", updatedAt: null, unreadCount: n })),
    messages: [1, 2].map((n) => ({ messageRef: `m${n}`, conversationRef: "conv-1", direction: "incoming" as const, text: "t", sentAt: null })),
    comments: [1, 2, 3].map((n) => ({ commentRef: `c${n}`, postRef: "post-1", authorName: "F", text: "t", createdAt: null })) });
  return { name: "FakeProvider", provider, cred: { secret: ZERNIO_TEST_KEY }, accountRef: "acc-ig-1", platform: "instagram",
    events: { published: () => fakeEvent("post.published"), failed: () => fakeEvent("post.failed", { errorCategory: "auth_expired" }), message: () => fakeEvent("message.received", { subjectRef: "conv-9" }), unknown: () => fakeEvent("analytics.updated") } };
}
function zernio(): Harness {
  const double = zernioDouble();
  return { name: "ZernioAdapter (mock fetch)", provider: new ZernioAdapter({ fetch: double.fetch, sleep: async () => {} }), cred: { secret: ZERNIO_TEST_KEY }, accountRef: "acc-ig-1", platform: "instagram",
    events: { published: () => zEvent(zernioEvents.postPublished()), failed: () => zEvent(zernioEvents.postFailed()), message: () => zEvent(zernioEvents.messageReceived()), unknown: () => zEvent(zernioEvents.unknown()) } };
}
const reject = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { return error; } return null; };

for (const make of [fake, zernio]) {
  const name = make().name;
  describe(`social provider port contract: ${name}`, () => {
    it("lists only supported-network accounts, in domain types", async () => {
      const { provider, cred } = make();
      expect(await provider.listAccounts(cred)).toEqual([{ accountRef: "acc-ig-1", platform: "instagram", displayName: "grace_church" }]);
    });
    it("rejects a wrong credential with AUTH and never echoes it", async () => {
      const { provider } = make();
      const error = await reject(provider.listAccounts({ secret: "wrong-credential-canary" }));
      expect(error).toBeInstanceOf(SocialProviderError);
      expect((error as SocialProviderError).code).toBe("AUTH");
      expect(String((error as Error).message) + JSON.stringify(error)).not.toContain("wrong-credential-canary");
    });
    it("reports account health", async () => {
      const { provider, cred, accountRef } = make();
      expect(await provider.getAccountHealth(cred, accountRef)).toEqual({ accountRef, health: "healthy", code: null });
      expect(((await reject(provider.getAccountHealth(cred, "nope"))) as SocialProviderError).code).toBe("NOT_FOUND");
    });
    it("publishes once per idempotency key and returns the original on a repeat", async () => {
      const { provider, cred, accountRef, platform } = make();
      const request = { idempotencyKey: "key-aaaaaaaa", accountRef, platform, content: "Sunday service at 10", media: [] };
      const first = await provider.publishPost(cred, request), again = await provider.publishPost(cred, { ...request, content: "different text, same key" });
      expect(again.postRef).toBe(first.postRef);
      expect((await provider.publishPost(cred, { ...request, idempotencyKey: "key-bbbbbbbb" })).postRef).not.toBe(first.postRef);
      expect(first.status).toBe("published");
    });
    it("rejects an unknown account as INVALID_REQUEST", async () => {
      const { provider, cred, platform } = make();
      expect(((await reject(provider.publishPost(cred, { idempotencyKey: "key-cccccccc", accountRef: "missing", platform, content: "x", media: [] }))) as SocialProviderError).code).toBe("INVALID_REQUEST");
    });
    it("schedules, reads status and cancels a scheduled post; refuses to cancel a published one", async () => {
      const { provider, cred, accountRef, platform } = make();
      const scheduled = await provider.publishPost(cred, { idempotencyKey: "key-dddddddd", accountRef, platform, content: "later", media: [], scheduledFor: new Date(Date.now() + 3_600_000) });
      expect(scheduled.status).toBe("scheduled");
      expect(await provider.getPostStatus(cred, scheduled.postRef)).toMatchObject({ postRef: scheduled.postRef, status: "scheduled" });
      await provider.cancelPost(cred, scheduled.postRef);
      expect((await provider.getPostStatus(cred, scheduled.postRef)).status).toBe("cancelled");
      const published = await provider.publishPost(cred, { idempotencyKey: "key-eeeeeeee", accountRef, platform, content: "now", media: [] });
      expect(((await reject(provider.cancelPost(cred, published.postRef))) as SocialProviderError).code).toBe("CONFLICT");
      expect(((await reject(provider.getPostStatus(cred, "missing-post"))) as SocialProviderError).code).toBe("NOT_FOUND");
    });
    it("pages conversations, messages and comments with an opaque cursor", async () => {
      const { provider, cred, accountRef } = make();
      const one = await provider.listConversations(cred, { accountRef, limit: 2 });
      expect(one.items).toHaveLength(2); expect(one.nextCursor).not.toBeNull();
      const two = await provider.listConversations(cred, { accountRef, limit: 2, cursor: one.nextCursor! });
      expect(two.items).toHaveLength(1); expect(two.nextCursor).toBeNull();
      expect(one.items[0]).toMatchObject({ accountRef, platform: "instagram" });
      const messages = await provider.listMessages(cred, { accountRef, conversationRef: "conv-1", limit: 10 });
      expect(messages.items.length).toBeGreaterThan(0); expect(messages.items[0]).toMatchObject({ conversationRef: "conv-1" });
      const comments = await provider.listComments(cred, { accountRef, postRef: "post-1", limit: 2 });
      expect(comments.items).toHaveLength(2); expect(comments.nextCursor).not.toBeNull();
    });
    it("verifies webhook signatures in constant-time hex form, with rotation secrets", () => {
      const { provider, events } = make(), { raw, sig } = events.published();
      expect(provider.verifyWebhook(raw, sig, [WEBHOOK_SECRET])).toBe(true);
      expect(provider.verifyWebhook(raw, sig, ["b".repeat(64), WEBHOOK_SECRET])).toBe(true);
      expect(provider.verifyWebhook(raw, sig, ["b".repeat(64)])).toBe(false);
      expect(provider.verifyWebhook(raw + " ", sig, [WEBHOOK_SECRET])).toBe(false);
      for (const bad of [null, "", "zz", sig.toUpperCase(), sig.slice(2)]) expect(provider.verifyWebhook(raw, bad, [WEBHOOK_SECRET])).toBe(false);
      expect(provider.verifyWebhook(raw, sig, [])).toBe(false);
    });
    it("parses post, inbox and unknown events into domain events without any message text", () => {
      const { provider, events } = make();
      const published = provider.parseWebhookEvent(events.published().raw)!;
      expect(published).toMatchObject({ kind: "post.published", accountRef: "acc-ig-1", subjectRef: expect.stringMatching(/^post-/), platform: "instagram" });
      expect(published.occurredAt).toBeInstanceOf(Date);
      expect(provider.parseWebhookEvent(events.failed().raw)).toMatchObject({ kind: "post.failed", errorCategory: "auth_expired" });
      const message = provider.parseWebhookEvent(events.message().raw)!;
      expect(message.kind).toBe("message.received");
      expect(message.subjectRef).toMatch(/^conv-/);
      expect(JSON.stringify(message)).not.toMatch(/PRIVATE PRAYER|Jane|jane_doe|SECRET TEXT/);
      expect(provider.parseWebhookEvent(events.unknown().raw)!.kind).toBe("other");
    });
    it("returns null for bodies that are not events", () => {
      const { provider } = make();
      for (const raw of ["", "not json", "[]", "null", "{}", JSON.stringify({ id: "x" }), JSON.stringify({ id: "", event: "post.published", type: "post.published" }), JSON.stringify({ id: "x", event: "post.published", type: "post.published", timestamp: "garbage" })]) expect(provider.parseWebhookEvent(raw), raw).toBeNull();
    });
  });
}
