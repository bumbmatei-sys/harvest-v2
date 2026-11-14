import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestKeyProvider, useKeyProvider } from "../../src/server/connect-key-provider";
import { FakeProvider } from "../../src/server/social/fake-provider";
import { receiveSocialWebhook } from "../../src/server/social/webhook";
import type { SocialDeps } from "../../src/server/social/registry";
import { webhookSecrets } from "../../src/server/social/webhook-secrets";
import type { Database } from "../../src/db/client";
import { sign } from "../social-fixtures";

// Every refusal that happens BEFORE the signature is trusted must be byte-identical, and none may touch the database.
afterEach(() => useKeyProvider(null));
const useKeys = () => useKeyProvider(createTestKeyProvider({ keys: () => ({ "test-1": "33".repeat(32) }), current: "test-1" }));
const db = new Proxy({}, { get: () => { throw new Error("DATABASE_TOUCHED"); } }) as unknown as Database;
const fake = new FakeProvider();
const deps = (enabled: boolean): SocialDeps => ({ enabled, provider: (id) => { if (id !== "fake") throw new Error("no"); return fake; }, now: () => new Date() });
const body = JSON.stringify({ id: "e1", type: "post.published", timestamp: new Date().toISOString(), accountRef: "a1" });
const post = (raw: string | Uint8Array, headers: Record<string, string> = {}) => new Request("http://localhost/api/integrations/social/webhook/fake", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw as BodyInit });
const read = async (r: Response) => ({ status: r.status, body: await r.text(), cache: r.headers.get("cache-control") });

describe("social webhook refusals", () => {
  it("answers every pre-signature refusal identically and never reaches the database", async () => {
    useKeys();
    const good = sign(body, webhookSecrets()[0]);
    const cases = await Promise.all([
      receiveSocialWebhook(db, post(body, { "x-fake-signature": good }), "fake", deps(false)),                       // integration disabled
      receiveSocialWebhook(db, post(body, { "x-fake-signature": good }), "unknown-provider", deps(true)),            // unknown provider
      receiveSocialWebhook(db, post(body, { "x-fake-signature": good, "content-type": "text/plain" }), "fake", deps(true)),
      receiveSocialWebhook(db, post("x".repeat(70_000), { "x-fake-signature": good }), "fake", deps(true)),          // too large
      receiveSocialWebhook(db, post(new Uint8Array([0xff, 0xfe]), { "x-fake-signature": good }), "fake", deps(true)), // not UTF-8
      receiveSocialWebhook(db, post(body), "fake", deps(true)),                                                      // no signature
      receiveSocialWebhook(db, post(body, { "x-fake-signature": sign(body, "f".repeat(64)) }), "fake", deps(true)),  // wrong secret
      receiveSocialWebhook(db, post(body, { "x-fake-signature": good.slice(0, 63) + (good.endsWith("0") ? "1" : "0") }), "fake", deps(true)), // one bit off
    ].map((p) => p.then(read)));
    expect(new Set(cases.map((c) => JSON.stringify(c))).size).toBe(1);
    expect(cases[0]).toMatchObject({ status: 404, cache: "private, no-store" });
    expect(cases[0].body).not.toMatch(/signature|secret|disabled|tenant|expired|size/i);
  });
  it("is disabled by default: the default dependencies refuse everything and build no provider call", async () => {
    useKeys();
    const spy = vi.spyOn(globalThis, "fetch");
    const response = await receiveSocialWebhook(db, post(body, { "x-zernio-signature": sign(body, webhookSecrets()[0]) }), "zernio");
    expect(response.status).toBe(404);
    expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
  });
  it("refuses when the key provider cannot supply a secret (fail closed)", async () => {
    useKeyProvider(createTestKeyProvider({ keys: () => ({}), current: "test-1" }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await receiveSocialWebhook(db, post(body, { "x-fake-signature": sign(body, "a".repeat(64)) }), "fake", deps(true))).status).toBe(404);
  });
  it("acknowledges an authentic but unusable delivery without touching the database", async () => {
    useKeys();
    const secret = webhookSecrets()[0], old = JSON.stringify({ id: "e2", type: "post.published", timestamp: new Date(Date.now() - 80 * 3_600_000).toISOString(), accountRef: "a1" });
    const future = JSON.stringify({ id: "e3", type: "post.published", timestamp: new Date(Date.now() + 3_600_000).toISOString(), accountRef: "a1" });
    for (const raw of [old, future, JSON.stringify({ id: "e4", type: "analytics.updated", timestamp: new Date().toISOString(), accountRef: "a1" }), JSON.stringify({ id: "e5", type: "post.published", timestamp: new Date().toISOString() }), "{}", "[1]"]) {
      expect(await read(await receiveSocialWebhook(db, post(raw, { "x-fake-signature": sign(raw, secret) }), "fake", deps(true)))).toMatchObject({ status: 202, body: JSON.stringify({ accepted: true }) });
    }
  });
});
