import { e2eDenialDetails } from "./e2e-diagnostics";
import { message } from "../i18n/messages";
import "server-only";
import { getAuth } from "./auth-instance";
import { workerSettings } from "./worker-settings";
import { AccessError } from "./permissions";
import { ZodError } from "zod";
import { requiredEnv } from "../lib/env";
export async function verifiedSessionUser(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) throw new AccessError(401, message("Errors.signInToContinue"));
  return session.user;
}
export async function verifiedUser(request: Request) {
  return (await verifiedSessionUser(request)).id;
}
export function verifyOrigin(request: Request) {
  if (request.headers.get("origin") !== (workerSettings.getStore()?.origin ?? new URL(requiredEnv("BETTER_AUTH_URL")).origin)) {
    throw new AccessError(403, message("Errors.requestOriginDenied"));
  }
}
function hasSqlState(error: unknown, codes: string[]): boolean {
  if (!error || typeof error !== "object") return false;
  return ("code" in error && typeof error.code === "string" && codes.includes(error.code)) || ("cause" in error && hasSqlState(error.cause, codes));
}
export function errorResponse(error: unknown) {
  if (error instanceof AccessError) return Response.json({ error: error.message, ...(error.details ? { details: error.details } : {}) }, { status: error.status });
  if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: message("Errors.checkTheSuppliedDetails") }, { status: 400 });
  if (hasSqlState(error, ["42501"])) {
    // Browser-test server only: name the table and constraint of the refused statement (no values) so an intermittent denial can be traced.
    const pg = error && typeof error === "object" ? ("cause" in error && error.cause && typeof error.cause === "object" ? error.cause : error) as { table?: string; constraint?: string; routine?: string; message?: string } : {};
    const details = e2eDenialDetails(pg);
    return Response.json({ error: message("Errors.workspaceAccessDenied"), ...(details ? { details } : {}) }, { status: 403 });
  }
  // P0404: a community Harvest paused refuses joins and forum or chat writes in the database (0137); the same answer as a missing community.
  if (hasSqlState(error, ["P0404"])) return Response.json({ error: message("Errors.communityNotFound") }, { status: 404 });
  // P0429: a database write limit (0129 community_write_rate_guard). The same answer whatever the limit or the record.
  if (hasSqlState(error, ["P0429"])) return Response.json({ error: message("Errors.communityWriteLimited") }, { status: 429, headers: { "Retry-After": "600" } });
  if (hasSqlState(error, ["40P01", "40001"])) return Response.json({ error: message("Errors.thisRecordChangedReloadAndTryAgain"), details: { reason: "stale" } }, { status: 409 });
  console.error("request_failed");
  return Response.json({ error: message("Errors.somethingWentWrongPleaseTryAgain") }, { status: 500 });
}
/** Search params as a record, keeping repeated keys (such as f=) as arrays. */
export function searchParamsRecord(url: string) {
  const record: Record<string, string | string[]> = {};
  for (const [key, value] of new URL(url).searchParams) { const previous = record[key]; record[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value]; }
  return record;
}
