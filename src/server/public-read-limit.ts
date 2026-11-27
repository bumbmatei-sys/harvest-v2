import { chargeRateLimit, rateLimitResponse, type RateLimitCharge } from "./request-rate-limit";
import { getDb, type Database } from "../db/client";
import { bioVisitorKey } from "./link-in-bio-public";
import { workerSettings } from "./worker-settings";

/**
 * Throttles anonymous public reads (Discover, the public community page and its beacon, the public blog), C23 follow-up F1. Community unsubscribe is
 * deliberately not throttled (one-click POSTs come from mailbox providers' servers, many real people behind one address).
 *
 * - Identity: the same keyed-hashed visitor key the link-in-bio and give-page report limits use (`bioVisitorKey`), so no raw address is
 *   stored or logged. On Workers the key comes from the request scope's secret and `cf-connecting-ip`. No usable address means no key and
 *   no counting (the read is served), as for those routes.
 * - Store: the existing `rate_limits` table that sign-in's database rate limiter already uses, under a `public-read:` key prefix. One row per
 *   visitor and scope holds a one-minute fixed window. Expired rows of this prefix are deleted by a sweep on every 50th charge in each
 *   server process, so an idle visitor's hashed key stays until the next sweep after its window ends (not a fixed one minute).
 * - Answer: the neutral `{ error: "rate_limited" }` 429 with Retry-After that hosted forms and the giving reports use.
 */
export const PUBLIC_READ_WINDOW_MS = 60_000;
/** Requests per visitor per minute. Discover listing, search and the Discover page share one budget. */
export const publicReadLimits = {
  discover: 60,
  "community-page": 60,
  "community-beacon": 60,
  /** The public blog: index, article, feed and pictures share one budget (a page loads several pictures). */
  blog: 120,
} as const;
export type PublicReadScope = keyof typeof publicReadLimits;
export type PublicReadCharge = RateLimitCharge;
const PREFIX = "public-read:", SWEEP_EVERY = 50;
let charges = 0;

/** Counts one request for this visitor and scope. */
export function chargePublicRead(db: Database, scope: PublicReadScope, visitor: string, now = Date.now(), sweep = ++charges % SWEEP_EVERY === 0): Promise<PublicReadCharge> {
  return chargeRateLimit(db, PREFIX, `${scope}:${visitor}`, publicReadLimits[scope], PUBLIC_READ_WINDOW_MS, now, sweep);
}

/** The visitor key for these limits, from request headers. */
export function publicVisitorKey(headers: Headers, env: Record<string, string | undefined> = process.env) {
  const scope = workerSettings.getStore();
  return bioVisitorKey({ headers }, scope ? { BETTER_AUTH_SECRET: scope.authSecret, AUTH_IP_ADDRESS_HEADERS: "cf-connecting-ip" } : env);
}

/** Charges the request; a failure of the limiter itself never blocks the read. */
export async function publicReadCharge(headers: Headers, scope: PublicReadScope, db: Database = getDb()): Promise<PublicReadCharge> {
  const visitor = publicVisitorKey(headers);
  if (!visitor) return { limited: false };
  try { return await chargePublicRead(db, scope, visitor); } catch { console.error("public_read_limit_failed"); return { limited: false }; }
}

export const publicReadLimited = rateLimitResponse;

/** For route handlers: the 429 to return, or null to carry on. */
export async function throttlePublicRead(request: Request, scope: PublicReadScope): Promise<Response | null> {
  const charge = await publicReadCharge(request.headers, scope);
  return charge.limited ? publicReadLimited(charge.retryAfter) : null;
}
