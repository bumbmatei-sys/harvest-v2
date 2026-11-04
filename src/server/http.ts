import "server-only";
import { getAuth } from "./auth-instance";
import { AccessError } from "./permissions";
import { ZodError } from "zod";
import { requiredEnv } from "../lib/env";
export async function verifiedUser(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) throw new AccessError(401, "Sign in to continue.");
  return session.user.id;
}
export function verifyOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(requiredEnv("BETTER_AUTH_URL")).origin) {
    throw new AccessError(403, "Request origin denied.");
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: "Check the supplied details." }, { status: 400 });
  console.error("request_failed");
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
