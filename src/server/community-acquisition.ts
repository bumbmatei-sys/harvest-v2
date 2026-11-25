import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { communitySlug } from "./communities";

// Anonymous acquisition counters for the community page. Privacy: a count per community, day and kind and nothing else. No cookie is set or read, no address, user id, session,
// referrer or user agent is stored. A literal switch keeps counting off until the founder approves the wording; while false the endpoint records nothing.
export const COMMUNITY_ACQUISITION_COUNTING_ENABLED = false;
export type AcquisitionDeps = { enabled: boolean };
export const defaultAcquisitionDeps = (): AcquisitionDeps => ({ enabled: COMMUNITY_ACQUISITION_COUNTING_ENABLED });
const kindInput = z.enum(["visit", "join_click"]);

/** Simple bot and prefetch filter on request headers only (nothing is stored). Crawlers, link previews, headless browsers, HTTP libraries and prefetches are not counted. */
export function isLikelyBot(headers: { get(name: string): string | null }) {
  const agent = headers.get("user-agent") ?? "";
  if (!agent || agent.length < 10) return true;
  if (/bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|headless|phantom|puppeteer|playwright|lighthouse|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch|httpclient|monitor|uptime|pingdom/i.test(agent)) return true;
  const purpose = `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""} ${headers.get("x-moz") ?? ""}`;
  return /prefetch|prerender|preview/i.test(purpose);
}

/** Counts one visit or join click. Returns false (and counts nothing) when counting is off, the request looks automated, or the community is not public. */
export async function countCommunityEvent(db: Database, slug: string, rawKind: unknown, headers: { get(name: string): string | null }, deps: AcquisitionDeps = defaultAcquisitionDeps()) {
  if (!deps.enabled) return false;
  const kind = kindInput.safeParse(rawKind), parsed = communitySlug.safeParse(slug);
  if (!kind.success || !parsed.success || isLikelyBot(headers)) return false;
  const { rows } = await db.transaction(tx => tx.execute<{ ok: boolean }>(sql`select public.community_count_event(${parsed.data}, ${kind.data}) as ok`));
  return rows[0]?.ok === true;
}
