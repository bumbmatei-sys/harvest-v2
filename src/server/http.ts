import { message } from "../i18n/messages";
import "server-only";
import { getAuth } from "./auth-instance";
import { AccessError } from "./permissions";
import { ZodError } from "zod";
import { requiredEnv } from "../lib/env";
export async function verifiedUser(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) throw new AccessError(401, message("Errors.signInToContinue"));
  return session.user.id;
}
export function verifyOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(requiredEnv("BETTER_AUTH_URL")).origin) {
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
  if (hasSqlState(error, ["42501"])) return Response.json({ error: message("Errors.workspaceAccessDenied") }, { status: 403 });
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
