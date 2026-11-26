import { z } from "zod";
import type { Dispatcher } from "./dispatch";
import { isRelayNonce, RELAY_MAX_BODY_CHARS, RELAY_MAX_BYTES, RELAY_MIN_KEY_LENGTH, RELAY_PATH, RELAY_WINDOW_SECONDS, relayHeaders, verifyRelaySignature } from "./relay-protocol";

/** Headers a CRM delivery may carry; anything else is refused, so the relay cannot be used to send arbitrary requests. */
const allowedHeader = /^(content-type|user-agent|harvest-[a-z-]{1,40})$/;
const envelope = z.object({
  url: z.string().min(1).max(2000),
  headers: z.record(z.string().regex(allowedHeader), z.string().max(512)).refine((value) => Object.keys(value).length <= 12),
  body: z.string().max(RELAY_MAX_BODY_CHARS),
  timeoutMs: z.number().int().min(1_000).max(15_000),
}).strict();

/** Single-use nonces, remembered for twice the acceptance window. A full cache refuses new requests rather than forgetting early. */
export class NonceCache {
  private seen = new Map<string, number>();
  constructor(private readonly capacity = 10_000) {}
  /** True when the nonce is new (and is now recorded); false when it was seen or the cache is full. */
  claim(nonce: string, nowMs: number) {
    const ttl = RELAY_WINDOW_SECONDS * 2_000;
    for (const [key, at] of this.seen) { if (nowMs - at < ttl) break; this.seen.delete(key); }
    if (this.seen.has(nonce) || this.seen.size >= this.capacity) return false;
    this.seen.set(nonce, nowMs);
    return true;
  }
}

const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const refuse = (status: number) => json(status, { error: "REFUSED" });

/** Reads at most `limit` bytes of the request body; null when it is longer. */
async function boundedText(request: Request, limit: number) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * The isolated egress relay (CF-05): authenticates the caller, then runs the Node dispatcher, which re-checks the destination and makes
 * the pinned, bounded HTTPS call. It answers only `{ ok, status }` or `{ ok: false, error }`, logs nothing about the request and keeps
 * no state beyond the nonce cache. Hosting it (a container with restricted egress) is a separate, approved deployment step.
 */
export function createRelayHandler({ key, dispatch, now = () => Date.now(), nonces = new NonceCache() }: { key: string; dispatch: Dispatcher; now?: () => number; nonces?: NonceCache }) {
  if (key.length < RELAY_MIN_KEY_LENGTH) throw new Error("WEBHOOK_EGRESS_KEY_TOO_SHORT");
  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname !== RELAY_PATH) return refuse(404);
    if (request.method !== "POST") return refuse(405);
    if (!/^application\/json(;|$)/i.test(request.headers.get("content-type") ?? "")) return refuse(415);
    const timestamp = request.headers.get(relayHeaders.timestamp), nonce = request.headers.get(relayHeaders.nonce), signature = request.headers.get(relayHeaders.signature);
    if (!timestamp || !/^\d{1,12}$/.test(timestamp) || !isRelayNonce(nonce) || !signature || !/^v1=[0-9a-f]{64}$/.test(signature)) return refuse(401);
    const nowMs = now();
    if (Math.abs(nowMs / 1000 - Number(timestamp)) > RELAY_WINDOW_SECONDS) return refuse(401);
    let raw: string | null;
    try { raw = await boundedText(request, RELAY_MAX_BYTES); } catch { return refuse(400); }
    if (raw === null) return refuse(413);
    if (!(await verifyRelaySignature(key, timestamp, nonce, raw, signature))) return refuse(401);
    // Recorded only after the signature checks out, so an unauthenticated flood cannot fill the cache.
    if (!nonces.claim(nonce, nowMs)) return refuse(409);
    let input: z.infer<typeof envelope>;
    try { input = envelope.parse(JSON.parse(raw)); } catch { return refuse(400); }
    const result = await dispatch(input);
    return json(200, result.ok ? { ok: true, status: result.status } : { ok: false, error: result.error });
  };
}
