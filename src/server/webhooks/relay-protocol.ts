/**
 * Webhook egress relay: how the caller (a Worker) and the isolated Node relay authenticate one dispatch. Web Crypto only, so the
 * same code runs on Workers and Node. A request carries a timestamp, a single-use nonce and HMAC-SHA256 over
 * "harvest.webhook-egress.v1\n<timestamp>\n<nonce>\n<raw body>" with a shared key that exists only in the two services' secrets.
 * The relay accepts a request once, within RELAY_WINDOW_SECONDS of its own clock.
 */
export const RELAY_PATH = "/v1/dispatch";
export const RELAY_WINDOW_SECONDS = 60;
/** Envelope cap: the CRM webhook body (64 KiB at most) plus headers and the destination, JSON-escaped. */
export const RELAY_MAX_BYTES = 160 * 1024;
export const RELAY_MIN_KEY_LENGTH = 32;
/** A CRM delivery body is at most 64 KiB (the CRM envelope cap); the relay refuses anything larger. */
export const RELAY_MAX_BODY_CHARS = 65_536;
export const relayHeaders = { timestamp: "x-harvest-egress-timestamp", nonce: "x-harvest-egress-nonce", signature: "x-harvest-egress-signature" } as const;
const NONCE = /^[A-Za-z0-9_-]{22,64}$/;
const encoder = new TextEncoder();

export const isRelayNonce = (value: string | null): value is string => !!value && NONCE.test(value);

async function hmac(key: string, message: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)));
}
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export async function signRelayRequest(key: string, timestamp: string, nonce: string, body: string) {
  return `v1=${hex(await hmac(key, `harvest.webhook-egress.v1\n${timestamp}\n${nonce}\n${body}`))}`;
}

/** Constant-time comparison of the expected and supplied signatures (equal-length strings). */
export async function verifyRelaySignature(key: string, timestamp: string, nonce: string, body: string, supplied: string) {
  const expected = await signRelayRequest(key, timestamp, nonce, body);
  if (supplied.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return difference === 0;
}

export function newRelayNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
