import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { communityMemberships, entitlements } from "../../db/schema";
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
export const recommendedCount = 3;
/**
 * C20 "Recommended": approved public listings only (the database function applies the same visibility rule as search). For a signed-in person the only personal input is what
 * they themselves joined or enrolled in, read under their own row policy and used for its public category; signed out (or with nothing joined) the order is non-personal:
 * the most recent public change first. Recommending never joins, enrols or charges anyone.
 */
export async function recommendDiscover(db: Database, user: string | null, type: DiscoverCard["type"] | undefined, deps: DiscoverDeps, limit = recommendedCount) {
  assertDiscoverEnabled(deps);
  const run = async (tx: Parameters<Parameters<Database["transaction"]>[0]>[0], seed: string[]) =>
    (await tx.execute<{ v: DiscoverCard[] }>(sql`select public.discover_recommend(${type ?? null}, ${`{${seed.join(",")}}`}::uuid[], ${limit}) as v`)).rows[0].v;
  if (!user) return { items: await db.transaction(tx => run(tx, [])), personal: false };
  return withUser(db, user, async (tx) => {
    const joined = await tx.select({ id: communityMemberships.communityId }).from(communityMemberships)
      .where(and(eq(communityMemberships.userId, user), eq(communityMemberships.status, "active"))).limit(250);
    const enrolled = await tx.select({ id: entitlements.resourceId }).from(entitlements)
      .where(and(eq(entitlements.userId, user), inArray(entitlements.resourceType, ["course", "product"]), isNull(entitlements.revokedAt),
        or(isNull(entitlements.validUntil), gt(entitlements.validUntil, sql`now()`)))).limit(250);
    const seed = [...new Set([...joined, ...enrolled].map(r => r.id))];
    return { items: await run(tx, seed), personal: seed.length > 0 };
  });
}
void DiscoverValidationError;
