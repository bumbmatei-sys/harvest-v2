import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Newsletter link-click tokens. A rewritten link carries only an opaque, HMAC-signed reference: the ministry, the campaign and its frozen revision,
 * the delivery and the link's position in that revision. It never carries the address, the person or the destination URL, so the redirect looks the
 * URL up in the frozen revision's link table and cannot be used as an open redirect. The key is injected (the newsletter token key), with its own
 * purpose string so a click token can never be read as an unsubscribe or confirmation token.
 */
export type ClickReference = { tenant: string; campaign: string; revision: number; delivery: string; link: number };

const VERSION = 1, PAYLOAD_BYTES = 1 + 16 * 3 + 4 + 2;
const PURPOSE = "newsletter-click-v1";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const clickTokenPattern = /^[A-Za-z0-9_-]{74}\.[A-Za-z0-9_-]{43}$/;
/** The most links one revision may track (the rest of a very long email stays untracked). */
export const MAX_TRACKED_LINKS = 200;

const uuidBytes = (value: string) => Buffer.from(value.replace(/-/g, ""), "hex");
const uuidText = (bytes: Buffer) => {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const mac = (key: Buffer, payload: string) => createHmac("sha256", key).update(PURPOSE).update(":").update(payload).digest();

export function signClickToken(key: Buffer, reference: ClickReference) {
  const { tenant, campaign, delivery, revision, link } = reference;
  if (![tenant, campaign, delivery].every((value) => uuidPattern.test(value)) || !Number.isInteger(revision) || revision < 1 || revision > 0x7fffffff
    || !Number.isInteger(link) || link < 0 || link >= MAX_TRACKED_LINKS) throw new Error("NEWSLETTER_CLICK_REFERENCE_INVALID");
  const bytes = Buffer.alloc(PAYLOAD_BYTES);
  bytes.writeUInt8(VERSION, 0);
  uuidBytes(tenant).copy(bytes, 1); uuidBytes(campaign).copy(bytes, 17); uuidBytes(delivery).copy(bytes, 33);
  bytes.writeUInt32BE(revision, 49); bytes.writeUInt16BE(link, 53);
  const payload = bytes.toString("base64url");
  return `${payload}.${mac(key, payload).toString("base64url")}`;
}

/** The reference inside a click token, or null for anything malformed, tampered with or signed with another key. */
export function verifyClickToken(key: Buffer | null, token: unknown): ClickReference | null {
  if (!key || typeof token !== "string" || !clickTokenPattern.test(token)) return null;
  const [payload, signature] = token.split(".");
  const expected = mac(key, payload), supplied = Buffer.from(signature, "base64url"), bytes = Buffer.from(payload, "base64url");
  // Only the canonical encoding is accepted: base64url's unused trailing bits must not give one token several spellings.
  if (supplied.toString("base64url") !== signature || bytes.toString("base64url") !== payload) return null;
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  if (bytes.length !== PAYLOAD_BYTES || bytes.readUInt8(0) !== VERSION) return null;
  const revision = bytes.readUInt32BE(49), link = bytes.readUInt16BE(53);
  if (revision < 1 || revision > 0x7fffffff || link >= MAX_TRACKED_LINKS) return null;
  return { tenant: uuidText(bytes.subarray(1, 17)), campaign: uuidText(bytes.subarray(17, 33)), delivery: uuidText(bytes.subarray(33, 49)), revision, link };
}

export const clickPath = "/api/newsletter/link";
/** The redirect address for one link of one delivery. */
export function clickUrl(origin: string, key: Buffer, reference: ClickReference) {
  const url = new URL(clickPath, origin);
  url.searchParams.set("t", signClickToken(key, reference));
  return url.href;
}

/**
 * Link rewriting for one rendered message. `links` is the frozen revision's stored list (index = position); a URL not in it is left as it is.
 * The unsubscribe link and other required mail links never reach this hook: the renderers call it only for content links.
 */
export function clickRewriter(links: readonly string[], tokenFor: (index: number) => string) {
  const index = new Map(links.map((url, position) => [url, position]));
  return (url: string) => {
    const position = index.get(url);
    return position === undefined ? url : tokenFor(position);
  };
}

/** Collects the distinct content links a renderer asks to track, in order of first appearance. */
export function linkCollector() {
  const seen: string[] = [];
  return { seen, track: (url: string) => { if (!seen.includes(url) && seen.length < MAX_TRACKED_LINKS) seen.push(url); return url; } };
}
