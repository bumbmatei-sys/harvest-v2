import { describe, expect, it, vi } from "vitest";
import type { Dispatcher } from "../../src/server/webhooks/dispatch";
import { directDispatcher } from "../../src/server/webhooks/direct-dispatcher";
import { relayDispatcher } from "../../src/server/webhooks/relay-client";
import { newRelayNonce, RELAY_PATH, RELAY_WINDOW_SECONDS, relayHeaders, signRelayRequest } from "../../src/server/webhooks/relay-protocol";
import { createRelayHandler, NonceCache } from "../../src/server/webhooks/relay-service";

const key = "k".repeat(40), origin = "https://egress.internal.test", now = 1_800_000_000_000;
const delivery = { url: "https://hooks.example.org/harvest", body: '{"id":"evt"}', timeoutMs: 10_000,
  headers: { "content-type": "application/json", "user-agent": "Harvest-Webhooks/1", "harvest-event-id": "evt", "harvest-signature": "v1=abc" } };

/** A client whose fetch goes straight into the relay handler (what a service binding does on Workers). */
function pair(dispatch: Dispatcher, options: { handlerNow?: number; nonces?: NonceCache } = {}) {
  const handler = createRelayHandler({ key, dispatch, now: () => options.handlerNow ?? now, nonces: options.nonces });
  const seen: Request[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => { const request = new Request(input, init); seen.push(request.clone()); return handler(request); }) as typeof fetch;
  return { handler, seen, client: relayDispatcher({ origin, key, fetcher, now: () => now }) };
}
async function signed(body: string, at = Math.floor(now / 1000), nonce = newRelayNonce(), signWith = key) {
  return new Request(new URL(RELAY_PATH, origin), { method: "POST", body, headers: { "content-type": "application/json",
    [relayHeaders.timestamp]: String(at), [relayHeaders.nonce]: nonce, [relayHeaders.signature]: await signRelayRequest(signWith, String(at), nonce, body) } });
}

describe("webhook egress relay (CF-05)", () => {
  it("carries a delivery to the dispatcher unchanged and returns only the status", async () => {
    const dispatch = vi.fn<Dispatcher>(async () => ({ ok: true, status: 202 }));
    const { client } = pair(dispatch);
    expect(await client(delivery)).toEqual({ ok: true, status: 202 });
    expect(dispatch).toHaveBeenCalledWith(delivery);
  });
  it("passes the dispatcher's refusal through, so a blocked destination stays permanent", async () => {
    const { client } = pair(async () => ({ ok: false, error: "BLOCKED_DESTINATION" }));
    expect(await client(delivery)).toEqual({ ok: false, error: "BLOCKED_DESTINATION" });
  });
  it("screens the destination inside the relay: a name resolving to a private address is never called", async () => {
    const transport = vi.fn(async () => ({ status: 200 }));
    const { client } = pair(directDispatcher(async () => [{ address: "10.0.0.7", family: 4 }], transport));
    expect(await client(delivery)).toEqual({ ok: false, error: "BLOCKED_DESTINATION" });
    expect(await client({ ...delivery, url: "http://hooks.example.org/x" })).toEqual({ ok: false, error: "INVALID_DESTINATION" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("pins the call to the screened address", async () => {
    const transport = vi.fn(async () => ({ status: 204 }));
    const { client } = pair(directDispatcher(async () => [{ address: "93.184.216.34", family: 4 }], transport));
    expect(await client(delivery)).toEqual({ ok: true, status: 204 });
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ address: "93.184.216.34", family: 4, body: delivery.body }));
  });
  it("refuses a wrong key, a tampered body, a stale or future timestamp and a replayed nonce", async () => {
    const dispatch = vi.fn<Dispatcher>(async () => ({ ok: true, status: 200 }));
    const { handler } = pair(dispatch);
    const body = JSON.stringify(delivery);
    expect((await handler(await signed(body, undefined, undefined, "x".repeat(40)))).status).toBe(401);
    const good = await signed(body);
    const tampered = new Request(good.url, { method: "POST", headers: good.headers, body: body.replace("evt", "evx") });
    expect((await handler(tampered)).status).toBe(401);
    expect((await handler(await signed(body, Math.floor(now / 1000) - RELAY_WINDOW_SECONDS - 1))).status).toBe(401);
    expect((await handler(await signed(body, Math.floor(now / 1000) + RELAY_WINDOW_SECONDS + 1))).status).toBe(401);
    const nonce = newRelayNonce();
    expect((await handler(await signed(body, undefined, nonce))).status).toBe(200);
    expect((await handler(await signed(body, undefined, nonce))).status).toBe(409);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it("refuses other paths, methods, content types, missing headers and oversize bodies", async () => {
    const { handler } = pair(async () => ({ ok: true, status: 200 }));
    expect((await handler(new Request(`${origin}/other`, { method: "POST" }))).status).toBe(404);
    expect((await handler(new Request(new URL(RELAY_PATH, origin)))).status).toBe(405);
    expect((await handler(new Request(new URL(RELAY_PATH, origin), { method: "POST", body: "{}", headers: { "content-type": "text/plain" } }))).status).toBe(415);
    expect((await handler(new Request(new URL(RELAY_PATH, origin), { method: "POST", body: "{}", headers: { "content-type": "application/json" } }))).status).toBe(401);
    expect((await handler(await signed("x".repeat(200 * 1024)))).status).toBe(413);
  });
  it("refuses envelopes that would turn the relay into a general proxy", async () => {
    const dispatch = vi.fn<Dispatcher>(async () => ({ ok: true, status: 200 }));
    const { handler } = pair(dispatch);
    for (const bad of [
      { ...delivery, headers: { ...delivery.headers, authorization: "Bearer x" } },
      { ...delivery, headers: { ...delivery.headers, host: "internal" } },
      { ...delivery, timeoutMs: 120_000 },
      { ...delivery, method: "DELETE" },
      { ...delivery, body: "x".repeat(70_000) },
    ]) expect((await handler(await signed(JSON.stringify(bad)))).status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("records nonces only after a valid signature, and a full cache refuses instead of forgetting", async () => {
    const nonces = new NonceCache(1);
    const { handler } = pair(async () => ({ ok: true, status: 200 }), { nonces });
    const body = JSON.stringify(delivery);
    expect((await handler(await signed(body, undefined, undefined, "x".repeat(40)))).status).toBe(401);
    expect((await handler(await signed(body))).status).toBe(200);
    expect((await handler(await signed(body))).status).toBe(409);
    // An entry is dropped only after its request could no longer be accepted, which makes room again.
    const late = now + 2 * RELAY_WINDOW_SECONDS * 1_000 + 1;
    expect(nonces.claim(newRelayNonce(), late + RELAY_WINDOW_SECONDS * 1_000, late)).toBe(true);
  });
  it("refuses a replay at the exact window boundary (timestamp at the future edge, replayed at the past edge)", async () => {
    const t0 = Math.floor(now / 1000), ts = t0 + RELAY_WINDOW_SECONDS, nonce = newRelayNonce(), body = JSON.stringify(delivery);
    const nonces = new NonceCache();
    let clock = now;
    const handler = createRelayHandler({ key, dispatch: async () => ({ ok: true, status: 200 }), now: () => clock, nonces });
    expect((await handler(await signed(body, ts, nonce))).status).toBe(200);
    // ts - (t0 + 120 s) = -60 s is still inside the window, so the nonce must still be remembered.
    clock = now + 2 * RELAY_WINDOW_SECONDS * 1_000;
    expect((await handler(await signed(body, ts, nonce))).status).toBe(409);
    clock += 1_000;
    expect((await handler(await signed(body, ts, nonce))).status).toBe(401);
  });
  it("client: any answer that is not a well-formed relay result is a retryable NETWORK failure; a slow relay is TIMEOUT", async () => {
    const answer = (response: Response) => relayDispatcher({ origin, key, fetcher: (async () => response) as typeof fetch });
    expect(await answer(new Response("{}", { status: 500 }))(delivery)).toEqual({ ok: false, error: "NETWORK" });
    expect(await answer(new Response("not json", { status: 200 }))(delivery)).toEqual({ ok: false, error: "NETWORK" });
    expect(await answer(new Response(JSON.stringify({ ok: true, status: 999 }), { status: 200 }))(delivery)).toEqual({ ok: false, error: "NETWORK" });
    expect(await answer(new Response(JSON.stringify({ ok: false, error: "SOMETHING" }), { status: 200 }))(delivery)).toEqual({ ok: false, error: "NETWORK" });
    expect(await answer(new Response(null, { status: 302, headers: { location: "https://elsewhere.test" } }))(delivery)).toEqual({ ok: false, error: "NETWORK" });
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect(await relayDispatcher({ origin, key, fetcher: (async () => { throw timeout; }) as typeof fetch })(delivery)).toEqual({ ok: false, error: "TIMEOUT" });
    expect(await relayDispatcher({ origin, key, fetcher: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch })(delivery)).toEqual({ ok: false, error: "NETWORK" });
  });
  it("client and relay refuse a short key", () => {
    expect(() => relayDispatcher({ origin, key: "short" })).toThrow("WEBHOOK_EGRESS_KEY_TOO_SHORT");
    expect(() => createRelayHandler({ key: "short", dispatch: async () => ({ ok: true, status: 200 }) })).toThrow("WEBHOOK_EGRESS_KEY_TOO_SHORT");
  });
  it("the relay request carries no tenant, URL or body outside the signed JSON", async () => {
    const { client, seen } = pair(async () => ({ ok: true, status: 200 }));
    await client(delivery);
    const [request] = seen;
    expect(new URL(request.url).pathname).toBe(RELAY_PATH);
    expect([...request.headers.keys()].sort()).toEqual(["content-type", relayHeaders.nonce, relayHeaders.signature, relayHeaders.timestamp].sort());
  });
});
