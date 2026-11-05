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
function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return ("code" in error && error.code === "42501") || ("cause" in error && isPermissionDenied(error.cause));
}
export function errorResponse(error: unknown) {
  if (error instanceof AccessError) return Response.json({ error: error.message, ...(error.details ? { details: error.details } : {}) }, { status: error.status });
  if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: message("Errors.checkTheSuppliedDetails") }, { status: 400 });
  if (isPermissionDenied(error)) return Response.json({ error: message("Errors.workspaceAccessDenied") }, { status: 403 });
  console.error("request_failed");
  return Response.json({ error: message("Errors.somethingWentWrongPleaseTryAgain") }, { status: 500 });
}
