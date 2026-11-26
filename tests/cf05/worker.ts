/**
 * CF-05 probe Worker. Runs the egress relay client and the relay's authentication on workerd itself:
 * - `/probe/client`: sends deliveries through `env.RELAY` (a service binding; in the local run it is the Node relay standing in for
 *   the isolated container) and reports what came back;
 * - `/probe/relay`: runs the relay handler inside the isolate against signed, tampered, stale and replayed requests.
 * No real destination is ever called: the Node relay uses a fixture resolver and transport.
 */
import { relayDispatcher } from "../../src/server/webhooks/relay-client";
import { newRelayNonce, RELAY_PATH, RELAY_WINDOW_SECONDS, relayHeaders, signRelayRequest } from "../../src/server/webhooks/relay-protocol";
import { createRelayHandler } from "../../src/server/webhooks/relay-service";

type Env = { RELAY: { fetch: typeof fetch }; RELAY_KEY: string };
const delivery = (url: string) => ({ url, body: '{"id":"evt_probe"}', timeoutMs: 5_000,
  headers: { "content-type": "application/json", "user-agent": "Harvest-Webhooks/1", "harvest-event-id": "evt_probe" } });

async function signed(key: string, body: string, at: number, nonce = newRelayNonce()) {
  return new Request(`https://relay.internal${RELAY_PATH}`, { method: "POST", body, headers: { "content-type": "application/json",
    [relayHeaders.timestamp]: String(at), [relayHeaders.nonce]: nonce, [relayHeaders.signature]: await signRelayRequest(key, String(at), nonce, body) } });
}

const probe = {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    if (path === "/probe/client") {
      const send = relayDispatcher({ origin: "https://relay.internal", key: env.RELAY_KEY, fetcher: env.RELAY.fetch.bind(env.RELAY) as typeof fetch });
      const wrongKey = relayDispatcher({ origin: "https://relay.internal", key: "w".repeat(40), fetcher: env.RELAY.fetch.bind(env.RELAY) as typeof fetch });
      return Response.json({
        publicTarget: await send(delivery("https://hooks.public.example/harvest")),
        privateTarget: await send(delivery("https://hooks.private.example/harvest")),
        plainHttp: await send(delivery("http://hooks.public.example/harvest")),
        wrongKey: await wrongKey(delivery("https://hooks.public.example/harvest")),
      });
    }
    if (path === "/probe/relay") {
      let calls = 0;
      const handler = createRelayHandler({ key: env.RELAY_KEY, dispatch: async () => { calls++; return { ok: true, status: 200 }; } });
      const body = JSON.stringify(delivery("https://hooks.public.example/harvest")), at = Math.floor(Date.now() / 1000), nonce = newRelayNonce();
      const good = await signed(env.RELAY_KEY, body, at, nonce);
      const results = {
        valid: (await handler(good.clone())).status,
        replay: (await handler(good)).status,
        wrongKey: (await handler(await signed("x".repeat(40), body, at))).status,
        stale: (await handler(await signed(env.RELAY_KEY, body, at - RELAY_WINDOW_SECONDS - 5))).status,
        tampered: (await handler(new Request((await signed(env.RELAY_KEY, body, at)).url, { method: "POST", headers: (await signed(env.RELAY_KEY, body, at)).headers, body: body.replace("probe", "probf") }))).status,
        extraHeader: (await handler(await signed(env.RELAY_KEY, JSON.stringify({ ...delivery("https://hooks.public.example/x"), headers: { authorization: "Bearer x" } }), at))).status,
        oversize: (await handler(await signed(env.RELAY_KEY, "x".repeat(200 * 1024), at))).status,
      };
      return Response.json({ ...results, dispatchCalls: calls });
    }
    return new Response("not found", { status: 404 });
  },
};
export default probe;
