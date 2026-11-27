import { expect, it, vi } from "vitest";
import type { ExternalBlogTarget } from "../../src/lib/external-blog";
import { ZernioAdapter } from "../../src/server/social/zernio-adapter";

const target: ExternalBlogTarget = { accountRef: "account", blogRef: "blog", platform: "wordpress" };
const credential = { secret: "synthetic-credential" };
const article = { id: "42", handle: "harvest-article", title: "Article", bodyHtml: "<p>Body</p>", status: "future", isPublished: false,
  publishDate: "2040-03-01T00:00:00Z" };

it("keeps the default adapter hard-off for Blogs", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  try {
    await expect(new ZernioAdapter().listBlogs(credential, target.accountRef)).rejects.toMatchObject({ code: "DISABLED" });
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});

it("uses a provider profile for sign-in and confirms a connected account inside that profile", async () => {
  const requests: { url: URL; options: RequestInit }[] = [];
  const adapter = new ZernioAdapter({ fetch: async (raw, options) => {
    const url = new URL(raw);
    requests.push({ url, options });
    if (url.pathname.endsWith("/profiles")) return Response.json({ profile: { _id: "profile-1" } });
    if (url.pathname.endsWith("/connect/shopify")) return Response.json({ authUrl: "https://sign-in.example.invalid/approve" });
    return Response.json({ accounts: [
      { _id: "wrong", platform: "shopify", profileId: "profile-2" }, { _id: "right", platform: "shopify", profileId: { _id: "profile-1" } },
    ] });
  } });
  const result = await adapter.startBlogConnect(credential, { attemptId: "attempt", platform: "shopify", shop: "test.myshopify.com",
    callback: "https://harvest.example.invalid/blog" });
  expect(result).toEqual({ profileRef: "profile-1", url: "https://sign-in.example.invalid/approve" });
  expect(requests[0].options.headers).toMatchObject({ "Idempotency-Key": "attempt" });
  expect(requests[1].url.searchParams.get("shop")).toBe("test.myshopify.com");
  expect(requests[1].url.searchParams.get("profileId")).toBe("profile-1");
  expect((await adapter.findBlogConnection(credential, result.profileRef, "shopify"))?.accountRef).toBe("right");
});

it("addresses article writes by blog, sends the immutable create key, and reads the full article during reconciliation", async () => {
  const requests: { url: URL; options: RequestInit }[] = [];
  const adapter = new ZernioAdapter({ fetch: async (raw, options) => {
    const url = new URL(raw);
    requests.push({ url, options });
    return Response.json(url.searchParams.has("handle") ? { articles: [{ ...article, bodyHtml: null }] } : { article });
  } });
  const draft = { title: "Article", bodyHtml: "<p>Body</p>", isPublished: false };
  const scheduled = await adapter.createBlogArticle(credential, target, { ...draft, isPublished: undefined, publishDate: article.publishDate }, "create-key");
  expect(scheduled.scheduledAt).toBe("2040-03-01T00:00:00.000Z");
  await adapter.updateBlogArticle(credential, target, scheduled.id, draft);
  expect(await adapter.findBlogArticle(credential, target, article.handle)).toMatchObject({ id: article.id, bodyHtml: article.bodyHtml });
  expect(requests.map(({ url, options }) => [options.method, url.pathname])).toEqual([
    ["POST", "/api/v1/accounts/account/blogs/blog/articles"], ["PATCH", "/api/v1/accounts/account/blogs/blog/articles/42"],
    ["GET", "/api/v1/accounts/account/blogs/blog/articles"], ["GET", "/api/v1/accounts/account/blogs/blog/articles/42"],
  ]);
  expect(requests[0].options.headers).toMatchObject({ "Idempotency-Key": "create-key" });
  expect(JSON.parse(String(requests[1].options.body))).toEqual(draft);
});
