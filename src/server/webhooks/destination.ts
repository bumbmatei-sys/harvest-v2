import { createHmac } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

/**
 * CRM-08 outbound webhook safety: which destinations may be called, how a call is signed, and the one
 * transport that makes it. Nothing here logs a URL, header or body.
 *
 * A destination must be an https:// URL on port 443 with a DNS name (IP literals, credentials,
 * fragments, single-label and local names are refused). Before every attempt the name is resolved and
 * EVERY address must be public; the connection is then pinned to the checked address so a second DNS
 * answer cannot swap in a private one (rebinding). Redirects are never followed: a 3xx is a failure.
 */
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  // (::/96 and ::ffff:0:0/96 are handled in isBlockedAddress: a BlockList IPv6 rule for them would also match every IPv4 address.)
  ["::", 127], ["64:ff9b::", 96], ["3fff::", 20], ["5f00::", 16], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(network, prefix, "ipv6");

/** IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:xxxx:xxxx) is judged by its IPv4 address. */
function mappedIPv4(address: string) {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (!hex) return null;
  const high = parseInt(hex[1], 16), low = parseInt(hex[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}
export function isBlockedAddress(address: string) {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 6) {
    const v4 = mappedIPv4(address);
    if (v4) return blocked.check(v4, "ipv4");
    // Unspecified, loopback and the deprecated IPv4-compatible form (::a.b.c.d) all start with "::".
    if (address.startsWith("::")) return true;
    return blocked.check(address, "ipv6");
  }
  return blocked.check(address, "ipv4");
}

/** Syntax-only check, used when an endpoint is saved and again before each attempt. */
export function parseDestination(raw: string): URL | null {
  if (typeof raw !== "string" || raw.length > 2000 || /[\s\u0000-\u001f]/.test(raw)) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || isIP(host.replace(/^\[|\]$/g, "")) !== 0) return null;
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|localdomain|corp)$/.test(host)) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  return url;
}

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
export const systemResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });
export type ResolvedDestination = { ok: true; url: URL; address: string; family: 4 | 6 } | { ok: false; error: "INVALID_DESTINATION" | "BLOCKED_DESTINATION" | "NETWORK" };
export const DNS_TIMEOUT_MS = 5_000;

/** Full check right before sending: syntax, then every resolved address must be public. */
export async function resolveDestination(raw: string, resolve: Resolver = systemResolver): Promise<ResolvedDestination> {
  const url = parseDestination(raw);
  if (!url) return { ok: false, error: "INVALID_DESTINATION" };
  let addresses: { address: string; family: number }[];
  // A failed or slow lookup is temporary (retried later), never a reason to call some other address.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([resolve(url.hostname), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS_TIMEOUT")), DNS_TIMEOUT_MS); })]);
  } catch { return { ok: false, error: "NETWORK" }; }
  finally { clearTimeout(timer); }
  if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) return { ok: false, error: "BLOCKED_DESTINATION" };
  const chosen = addresses[0];
  return { ok: true, url, address: chosen.address, family: isIP(chosen.address) === 6 ? 6 : 4 };
}

/** Per-endpoint signing secret, derived from the server key; nothing secret is stored in the database. */
export function endpointSecret(serverKey: string, tenantId: string, endpointId: string, secretVersion: number) {
  return `whsec_${createHmac("sha256", serverKey).update(`harvest.crm-webhook.v1:${tenantId}:${endpointId}:${secretVersion}`).digest("base64url")}`;
}
/** Receivers verify HMAC-SHA256(secret, "<event id>.<timestamp>.<raw body>") against `v1=<hex>`. */
export function signDelivery(secret: string, eventId: string, timestamp: string, body: string) {
  return `v1=${createHmac("sha256", secret).update(`${eventId}.${timestamp}.${body}`).digest("hex")}`;
}

export type TransportRequest = { url: URL; address: string; family: 4 | 6; headers: Record<string, string>; body: string; timeoutMs: number };
export type Transport = (request: TransportRequest) => Promise<{ status: number }>;
export class TransportError extends Error { constructor(public code: "TIMEOUT" | "NETWORK") { super(code); } }

/** The real HTTPS transport: pinned address, bounded time, no redirects, response body discarded. */
export const httpsTransport: Transport = (input) => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
  const request = httpsRequest({
    protocol: "https:", hostname: input.url.hostname, port: 443, path: `${input.url.pathname}${input.url.search}`, method: "POST",
    headers: { ...input.headers, "content-length": Buffer.byteLength(input.body).toString() }, agent: false,
    // Pin the connection to the address that passed the check (SNI and certificate still use the name).
    lookup: (_hostname, options, callback) => {
      if ((options as { all?: boolean }).all) (callback as unknown as (error: null, list: { address: string; family: number }[]) => void)(null, [{ address: input.address, family: input.family }]);
      else callback(null, input.address, input.family);
    },
  }, (response) => {
    let received = 0;
    response.on("data", (chunk: Buffer) => { received += chunk.length; if (received > 4096) response.destroy(); });
    response.on("close", () => finish(() => resolve({ status: response.statusCode ?? 0 })));
    response.on("error", () => finish(() => resolve({ status: response.statusCode ?? 0 })));
  });
  const timer = setTimeout(() => { request.destroy(); finish(() => reject(new TransportError("TIMEOUT"))); }, input.timeoutMs);
  request.on("error", () => finish(() => reject(new TransportError("NETWORK"))));
  request.end(input.body);
});
