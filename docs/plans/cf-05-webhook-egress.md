# CF-05 · Webhook egress relay

CF-01 showed that the CRM webhook sender cannot run unchanged on Workers: `https.request` rejects the custom `lookup` that pins the connection to the screened address (`ERR_OPTION_NOT_IMPLEMENTED`), and ordinary `fetch` must not be substituted. This slice keeps the Node sender exactly as it is and puts it behind an authenticated relay, the container fallback the [infrastructure PRD](../prd/cloudflare-infrastructure-migration.md) allows. [CF-01 findings](cf-01-compatibility-spike.md)

## What is built

| Piece | File | Runs on |
| --- | --- | --- |
| Dispatch contract: one send = check the destination, then POST; result is only `{ ok, status }` or a fixed error | `src/server/webhooks/dispatch.ts` | both |
| Direct dispatcher: today's `resolveDestination` + pinned `httpsTransport`, unchanged | `src/server/webhooks/direct-dispatcher.ts` | Node |
| Relay protocol: timestamp, single-use nonce, HMAC-SHA256 over `harvest.webhook-egress.v1\n<ts>\n<nonce>\n<body>`, Web Crypto only | `src/server/webhooks/relay-protocol.ts` | both |
| Relay client (Worker side): signs, posts to the relay over a service binding, maps anything unexpected to a retryable `NETWORK` | `src/server/webhooks/relay-client.ts` | Workers |
| Relay service: authenticates, refuses replays, bounds the body, allows only the CRM delivery shape and headers, then runs the direct dispatcher | `src/server/webhooks/relay-service.ts` | Node (container) |

`runWebhookDeliveries` gains an optional `dispatch`. Without it the Node path is unchanged (`directDispatcher(resolve, transport)`); a Worker would pass `relayDispatcher(...)`. Blocked and invalid destinations stay permanent failures, as before.

## Relay rules

- 60-second window on the relay's clock; nonce recorded only after the signature verifies, kept for 120 s, cache bounded at 10,000 (full means refuse, never forget early).
- Key at least 32 characters, held only in the two services' secrets.
- Request: `POST /v1/dispatch`, `application/json`, at most 160 KiB; envelope exactly `{ url, headers, body, timeoutMs }`, body ≤ 64 KiB, `timeoutMs` 1–15 s, headers limited to `content-type`, `user-agent` and `harvest-*` (no `authorization`, `host`, cookies), at most 12.
- The relay re-runs the full destination check: https on 443, DNS names only, every resolved address public, connection pinned to the checked address, no redirects, 4 KiB response cap, bounded time. Nothing is logged about the request.

## Verification

| Check | Result |
| --- | --- |
| `tests/unit/webhook-egress-relay.test.ts` | 11 passed: round trip, private and plain-http targets refused inside the relay, pinning, wrong key, tampered body, stale and future timestamps, replay, method/path/type/size refusals, proxy-shaped envelopes refused, nonce cache, client failure mapping, short key. |
| `tests/integration/crm08-webhooks.test.ts` | 10 passed with the refactored delivery path. |
| `tests/cf05/run-local.ts` on workerd (Miniflare `5.20261117.0-beta`) | Passed. The probe Worker signs and sends through a service binding to the Node relay (fixture DNS and transport): public target 202, a name with a private second answer `BLOCKED_DESTINATION`, plain http `INVALID_DESTINATION`, wrong key `NETWORK`, and only the public, screened address was "contacted". The relay handler also ran inside the isolate: valid 200, replay 409, wrong key 401, stale 401, tampered 401, extra header 400, oversize 413, one dispatch. |
| Full unit suite, lint, typecheck | 1,766 passed; clean. |

Run the workerd check from a disposable tooling directory: `npm i miniflare@5.20261117.0-beta esbuild`, then `CF05_MINIFLARE_MODULE=<abs>/node_modules/miniflare/dist/src/index.js node --import tsx tests/cf05/run-local.ts`.

## Not done (needs approval or a later slice)

- No container, service binding, secret or egress rule exists. Provisioning the relay (a Cloudflare Container or other isolated Node host with restricted egress) is a deployment step for the founder.
- No real destination, TLS certificate or DNS answer was used. A TLS fixture (certificate name mismatch, IPv6 answers) on the container host and an independent security review remain before activation.
- Webhook delivery stays hard-off (`webhookDeliveryEnabled`), and nothing here changes when it is allowed.
- Inbound provider webhooks keep their existing receiver; their verification uses Node crypto under `nodejs_compat` and is covered by CF-03's request checks.
