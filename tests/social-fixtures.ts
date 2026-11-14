import { createHmac } from "node:crypto";
import type { FetchLike } from "../src/server/social/zernio-adapter";

// Recorded-shape fixtures for the vendor wire format, plus an in-memory HTTP double that behaves like the documented API.
// Nothing here opens a socket: it is a function with the shape of fetch.
export const ZERNIO_TEST_KEY = "zernio-test-key-canary-7f3a91";
export const WEBHOOK_SECRET = "a".repeat(64);
export const sign = (rawBody: string, secret = WEBHOOK_SECRET) => createHmac("sha256", secret).update(rawBody).digest("hex");

export type RecordedRequest = { url: string; method: string; headers: Record<string, string>; body: unknown };
export type ZernioDouble = { fetch: FetchLike; requests: RecordedRequest[]; script: (...responses: (Response | Error)[]) => void; posts: Map<string, { status: string; key: string | null }> };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
export const jsonResponse = json;

/** A tiny stateful double of the documented endpoints. `script()` queues responses that pre-empt it (for error and retry tests). */
export function zernioDouble(): ZernioDouble {
  const requests: RecordedRequest[] = [], queued: (Response | Error)[] = [], posts = new Map<string, { status: string; key: string | null }>(), byKey = new Map<string, string>();
  const accounts = [{ _id: "acc-ig-1", platform: "instagram", username: "grace_church" }, { _id: "acc-x-1", platform: "twitter", username: "not_supported" }];
  const conversations = [1, 2, 3].map((n) => ({ id: `conv-${n}`, platform: "instagram", accountId: "acc-ig-1", participantName: `Person ${n}`, lastMessage: `hello ${n}`, updatedTime: "2026-11-09T14:00:03Z", status: "active", unreadCount: n }));
  let counter = 0;
  const page = (items: unknown[], cursor: string | null, limit: number, key: "data" | "comments") => {
    const start = cursor ? Number(cursor) : 0;
    return json(200, { [key]: items.slice(start, start + limit), pagination: { nextCursor: start + limit < items.length ? String(start + limit) : null, cursor: start + limit < items.length ? String(start + limit) : null } });
  };
  const handler: FetchLike = async (url, init) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    requests.push({ url, method: init.method ?? "GET", headers, body: init.body ? JSON.parse(init.body as string) : undefined });
    const next = queued.shift();
    if (next instanceof Error) throw next;
    if (next) return next;
    if (headers.authorization !== `Bearer ${ZERNIO_TEST_KEY}`) return json(401, { error: "nope", type: "authentication_error" });
    const u = new URL(url), path = u.pathname.replace("/api/v1", ""), method = init.method ?? "GET", body = init.body ? JSON.parse(init.body as string) : {};
    if (method === "GET" && path === "/accounts") return json(200, { accounts });
    let m: RegExpExecArray | null;
    if (method === "GET" && (m = /^\/accounts\/([^/]+)\/health$/.exec(path))) return accounts.some((a) => a._id === m![1]) ? json(200, { health: { status: "healthy" } }) : json(404, { error: "missing" });
    if (method === "POST" && path === "/posts") {
      const key = headers["idempotency-key"] ?? null;
      if (key && byKey.has(key)) return json(200, { post: { _id: byKey.get(key), status: posts.get(byKey.get(key)!)!.status } });
      if (!body.platforms?.[0] || !accounts.some((a) => a._id === body.platforms[0].accountId)) return json(400, { error: "bad", type: "invalid_request_error" });
      const id = `post-${++counter}`, status = body.publishNow ? "published" : "scheduled";
      posts.set(id, { status, key }); if (key) byKey.set(key, id);
      return json(201, { post: { _id: id, status } });
    }
    if ((m = /^\/posts\/([^/]+)$/.exec(path))) {
      const post = posts.get(m[1]);
      if (!post) return json(404, { error: "missing" });
      if (method === "GET") return json(200, { post: { _id: m[1], status: post.status, platforms: [] } });
      if (method === "DELETE") { if (post.status !== "scheduled") return json(409, { error: "cannot" }); post.status = "cancelled"; return json(200, { message: "deleted" }); }
    }
    if (method === "GET" && path === "/inbox/conversations") return page(conversations.filter((c) => c.accountId === u.searchParams.get("accountId")), u.searchParams.get("cursor"), Number(u.searchParams.get("limit") ?? 25), "data");
    if (method === "GET" && (m = /^\/inbox\/conversations\/([^/]+)\/messages$/.exec(path))) return page([1, 2].map((n) => ({ id: `msg-${n}`, conversationId: m![1], direction: n === 1 ? "incoming" : "outgoing", text: `text ${n}`, createdAt: "2026-11-09T14:00:03Z" })), u.searchParams.get("cursor"), Number(u.searchParams.get("limit") ?? 25), "data");
    if (method === "GET" && (m = /^\/inbox\/comments\/([^/]+)$/.exec(path))) return page([1, 2, 3].map((n) => ({ id: `cm-${n}`, message: `comment ${n}`, from: { name: `Fan ${n}` }, createdTime: "2026-11-09T14:00:03Z" })), u.searchParams.get("cursor"), Number(u.searchParams.get("limit") ?? 25), "comments");
    if (method === "POST" && (m = /^\/inbox\/conversations\/([^/]+)\/messages$/.exec(path))) return json(200, { message: { id: "sent-1" } });
    if (method === "POST" && (m = /^\/inbox\/comments\/([^/]+)$/.exec(path))) return json(200, { comment: { id: "reply-1" } });
    return json(404, { error: "unknown route" });
  };
  return { fetch: handler, requests, posts, script: (...r) => { queued.push(...r); } };
}

/** Recorded shapes of vendor webhook deliveries (ids and text are synthetic). */
export const zernioEvents = {
  postPublished: (id = "evt_post_1", extra: Record<string, unknown> = {}) => JSON.stringify({ id, event: "post.published", timestamp: new Date().toISOString(), post: { id: "post-1", status: "published", platforms: [{ platform: "instagram", accountId: "acc-ig-1", status: "published" }] }, ...extra }),
  postFailed: (id = "evt_post_2") => JSON.stringify({ id, event: "post.failed", timestamp: new Date().toISOString(), post: { id: "post-1", status: "failed", platforms: [{ platform: "instagram", accountId: "acc-ig-1", status: "failed", errorCategory: "auth_expired", errorMessage: "SECRET TEXT SHOULD NOT BE KEPT" }] } }),
  messageReceived: (id = "evt_msg_1") => JSON.stringify({ id, event: "message.received", timestamp: new Date().toISOString(), message: { id: "msg-9", conversationId: "conv-9", platform: "instagram", direction: "incoming", text: "PRIVATE PRAYER REQUEST", sender: { id: "u1", name: "Jane Doe", username: "jane_doe" } }, conversation: { id: "conv-9", status: "active" }, account: { id: "acc-ig-1", accountId: "acc-ig-1", platform: "instagram" } }),
  accountDisconnected: (id = "evt_acc_1") => JSON.stringify({ id, event: "account.disconnected", timestamp: new Date().toISOString(), account: { accountId: "acc-ig-1", platform: "instagram" }, reasonCode: "auth_failed" }),
  unknown: (id = "evt_other_1") => JSON.stringify({ id, event: "analytics.updated", timestamp: new Date().toISOString() }),
};
