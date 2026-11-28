import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../db/client";

export type RateLimitCharge = { limited: false } | { limited: true; retryAfter: number };

/** Counts one request for this key. Over the limit, the window is not extended and the count stops growing. */
export async function chargeRateLimit(db: Database, prefix: string, key: string, max: number, windowMs: number, now: number, sweep: boolean): Promise<RateLimitCharge> {
  const expired = now - windowMs;
  if (sweep) await db.execute(sql`delete from rate_limits where key like ${`${prefix}%`} and last_request <= ${expired}`);
  const { rows: [row] } = await db.execute<{ count: number; last_request: string | number }>(sql`
    insert into rate_limits (id, key, count, last_request) values (${randomUUID()}, ${`${prefix}${key}`}, 1, ${now})
    on conflict (key) do update set
      count = case when rate_limits.last_request <= ${expired} then 1 else least(rate_limits.count + 1, ${max + 1}) end,
      last_request = case when rate_limits.last_request <= ${expired} then ${now} else rate_limits.last_request end
    returning count, last_request`);
  if (Number(row.count) <= max) return { limited: false };
  const retryAfter = Math.min(Math.ceil(windowMs / 1000), Math.max(1, Math.ceil((Number(row.last_request) + windowMs - now) / 1000)));
  return { limited: true, retryAfter };
}

export const rateLimitResponse = (retryAfter: number) =>
  Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } });
