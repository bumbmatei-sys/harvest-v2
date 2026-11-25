import { decisionInput, discoverTypes, type DiscoverType } from "../../lib/discover";
import { invalid } from "./owner";

// Platform review. There is no platform-admin identity model yet (founder decision pending), so these functions take a connection that is verified to be the worker database role
// and the database grants the underlying functions to that role only. No web route calls them.
type Pool = { query<R extends Record<string, unknown>>(query: string, values: unknown[]): Promise<{ rows: R[] }> };
export type QueueItem = { tenantId: string; type: DiscoverType; id: string; state: string; reason: string | null; version: number; requestedAt: string; name: string | null; summary: string | null;
  hostName: string | null; category: string | null; language: string | null; audience: string | null; free: boolean | null; materialChange: boolean; openReports: number };

export async function listReviewQueue(pool: Pool, state: "pending" | "approved" | "rejected" | "suspended" = "pending", limit = 25) {
  const { rows } = await pool.query<{ q: QueueItem[] }>("select public.discover_platform_queue($1, $2) as q", [state, limit]);
  return rows[0].q;
}
export type Decision = { tenantId: string; type: DiscoverType; id: string; version: number; reviewer: string };
/** Approve, reject (reason required), suspend (reason required) or reinstate. Returns the new state, or `stale`, `not_found` or `not_reviewable`. */
export async function decideReview(pool: Pool, target: Decision, raw: unknown) {
  const d = decisionInput.safeParse(raw);
  if (!d.success || !(discoverTypes as readonly string[]).includes(target.type)) throw invalid("DISCOVER_INVALID_DECISION");
  const reason = "reason" in d.data ? d.data.reason : null;
  const { rows } = await pool.query<{ r: string }>("select public.discover_platform_decide($1::uuid, $2, $3::uuid, $4, $5, $6, $7) as r", [target.tenantId, target.type, target.id, d.data.decision, reason, target.reviewer, target.version]);
  return rows[0].r;
}
export async function setMinistryStanding(pool: Pool, tenantId: string, suspended: boolean, reviewer: string, reason: string | null = null) {
  await pool.query("select public.discover_platform_standing($1::uuid, $2, $3, $4)", [tenantId, suspended, reason, reviewer]);
}
export async function listReports(pool: Pool, limit = 25) {
  const { rows } = await pool.query<{ r: { id: string; tenantId: string; type: DiscoverType; resourceId: string; reason: string; note: string | null; createdAt: string }[] }>("select public.discover_platform_reports($1) as r", [limit]);
  return rows[0].r;
}
export async function resolveReport(pool: Pool, id: string, status: "reviewed" | "dismissed", reviewer: string) {
  const { rows } = await pool.query<{ r: boolean }>("select public.discover_platform_resolve_report($1::uuid, $2, $3) as r", [id, status, reviewer]);
  return rows[0].r;
}
