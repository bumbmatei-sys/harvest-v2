/**
 * CF-05 local run on workerd (Miniflare). The probe Worker (tests/cf05/worker.ts) is the caller; the relay runs here in Node, standing in
 * for the isolated container, with the real directDispatcher over a fixture resolver and transport, so no destination is ever contacted.
 *
 *   CF05_MINIFLARE_MODULE=/abs/path/node_modules/miniflare/dist/src/index.js node --import tsx tests/cf05/run-local.ts
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { directDispatcher } from "../../src/server/webhooks/direct-dispatcher";
import { createRelayHandler } from "../../src/server/webhooks/relay-service";

const entry = process.env.CF05_MINIFLARE_MODULE;
if (!entry || !entry.startsWith("/")) throw new Error("Set CF05_MINIFLARE_MODULE to the absolute path of an installed Miniflare package entry");
const { Miniflare, convertV4MiniflareOptions } = await import(entry) as {
  Miniflare: new (options: object) => { dispatchFetch: (url: string) => Promise<Response>; dispose: () => Promise<void> };
  convertV4MiniflareOptions: (options: object) => object;
};

const key = randomBytes(36).toString("base64url");
const sent: { address: string; host: string }[] = [];
// Fixture DNS: one public answer, one private (an SSRF/rebinding attempt). The transport records where it would connect.
const relay = createRelayHandler({ key, dispatch: directDispatcher(
  async (name) => name === "hooks.private.example" ? [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }] : [{ address: "93.184.216.34", family: 4 }],
  async (request) => { sent.push({ address: request.address, host: request.url.hostname }); return { status: 202 }; },
) });

const directory = await mkdtemp(join(tmpdir(), "harvest-cf05-"));
let runtime: { dispatchFetch: (url: string) => Promise<Response>; dispose: () => Promise<void> } | undefined;
try {
  const scriptPath = join(directory, "worker.mjs");
  await build({ entryPoints: ["tests/cf05/worker.ts"], outfile: scriptPath, bundle: true, format: "esm", platform: "neutral", conditions: ["workerd", "worker", "browser"], mainFields: ["module", "main"] });
  runtime = new Miniflare(convertV4MiniflareOptions({ cf: false, host: "127.0.0.1", modules: true, modulesRoot: directory, scriptPath, compatibilityDate: "2026-11-17", bindings: { RELAY_KEY: key }, serviceBindings: { RELAY: (request: Request) => relay(request) } }));
  const client = await (await runtime.dispatchFetch("http://probe/probe/client")).json() as Record<string, unknown>;
  assert.deepEqual(client.publicTarget, { ok: true, status: 202 });
  assert.deepEqual(client.privateTarget, { ok: false, error: "BLOCKED_DESTINATION" });
  assert.deepEqual(client.plainHttp, { ok: false, error: "INVALID_DESTINATION" });
  assert.deepEqual(client.wrongKey, { ok: false, error: "NETWORK" });
  assert.deepEqual(sent, [{ address: "93.184.216.34", host: "hooks.public.example" }]);
  const inIsolate = await (await runtime.dispatchFetch("http://probe/probe/relay")).json() as Record<string, number>;
  assert.deepEqual(inIsolate, { valid: 200, replay: 409, wrongKey: 401, stale: 401, tampered: 401, extraHeader: 400, oversize: 413, dispatchCalls: 1 });
  console.log(JSON.stringify({ workerd: "ok", client, inIsolate }));
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
