import { sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { decodeCursor, discoverPageSize, encodeCursor, reportInput, searchInput } from "../../lib/discover";
import { withUser } from "../tenancy";
import { AccessError } from "../permissions";
import { message } from "../../i18n/messages";
import { DiscoverValidationError, invalid } from "./owner";
import { assertDiscoverEnabled, type DiscoverDeps } from "./registry";

export type DiscoverCard = { type: "community" | "course" | "product"; id: string; slug: string; name: string; summary: string | null; hostName: string; category: string | null; language: string | null;
  audience: string | null; free: boolean; pricing: string; admission: string[] | null; updatedAt: string };

/** Query-string form: `free` is "1" or "0"; anything unknown is refused rather than ignored. */
export function parseSearch(params: URLSearchParams) {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of params) { if (k in raw) throw invalid("DISCOVER_INVALID_QUERY"); raw[k] = v; }
  if ("free" in raw) { if (raw.free !== "1" && raw.free !== "0") throw invalid("DISCOVER_INVALID_QUERY"); raw.free = raw.free === "1"; }
  const parsed = searchInput.safeParse(raw);
  if (!parsed.success) throw invalid("DISCOVER_INVALID_QUERY");
  return parsed.data;
}

/**
 * Public, unauthenticated search. Every rule is applied in the database function (server side, not in the UI): the item is published, listed and opted in (it has a projection row),
 * approved for exactly its current public fields, and its ministry is not suspended. The response carries sanitized listing fields and per-type facet counts, never a tenant id or member data.
 */
export async function searchDiscover(db: Database, rawQuery: URLSearchParams | unknown, deps: DiscoverDeps) {
  assertDiscoverEnabled(deps);
  const q = rawQuery instanceof URLSearchParams ? parseSearch(rawQuery) : searchInput.parse(rawQuery);
  let offset: number;
  try { offset = decodeCursor(q.cursor); } catch { throw invalid("DISCOVER_INVALID_CURSOR"); }
  const { rows } = await db.transaction(tx => tx.execute<{ v: { items: DiscoverCard[]; hasMore: boolean; facets: Record<string, number> } }>(sql`select public.discover_search(${q.q ?? ""}, ${q.type ?? null}, ${q.category ?? null}, ${q.language ?? null},
    ${q.audience ?? null}, ${q.free ?? null}, ${q.sort}, ${offset}, ${discoverPageSize}) as v`));
  const result = rows[0].v;
  return { items: result.items, facets: { community: 0, course: 0, product: 0, ...result.facets }, next: result.hasMore ? encodeCursor(offset + discoverPageSize) : null };
}

/** A signed-in person flags a visible listing for the platform. The ministry never learns who reported. */
export async function reportListing(db: Database, user: string, raw: unknown, deps: DiscoverDeps) {
  assertDiscoverEnabled(deps);
  const input = reportInput.safeParse(raw);
  if (!input.success) throw invalid("DISCOVER_INVALID_REPORT");
  const status = await withUser(db, user, async (tx) => (await tx.execute<{ s: string }>(sql`select public.discover_report(${input.data.type}, ${input.data.id}::uuid, ${input.data.reason}, ${input.data.note ?? null}) as s`)).rows[0].s);
  if (status === "unknown") throw new AccessError(404, message("Errors.workspaceUnavailable"));
  if (status === "rate_limited") throw new AccessError(429, message("Errors.somethingWentWrongPleaseTryAgain"));
  return { status: status as "reported" | "duplicate" };
}
void DiscoverValidationError;
