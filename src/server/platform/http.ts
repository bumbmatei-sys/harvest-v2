import { getDb, type Database } from "../../db/client";
import { errorResponse, verifyOrigin } from "../http";
import { getAuth } from "../auth-instance";
import { message } from "../../i18n/messages";
import { AccessError } from "../permissions";
import { DiscoverValidationError, invalid } from "../discover/owner";
import { discoverRouteDeps } from "../discover/gate";
import { assertDiscoverEnabled, type DiscoverDeps } from "../discover/registry";
import { readBoundedJson } from "../request-json";
import { assertFreshSignIn, staffRole } from "./staff";

const headers = { "Cache-Control": "private, no-store" };
/**
 * Staff route wrapper: hard-off first (the Discover literal switch), then origin for writes, a session, a sign-in within the last 15 minutes, and an active staff role. Anyone who
 * is not active staff gets the same neutral 404 as an unknown route; a stale sign-in gets 401 with `REAUTH_REQUIRED`.
 */
export async function platformResponse(request: Request, write: boolean, run: (db: Database, user: string) => Promise<unknown>, status = 200, deps: DiscoverDeps = discoverRouteDeps(), now = () => new Date()) {
  try {
    assertDiscoverEnabled(deps);
    if (write) verifyOrigin(request);
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) throw new AccessError(401, message("Errors.signInToContinue"));
    const db = getDb();
    if (!(await staffRole(db, session.user.id))) throw new AccessError(404, message("Errors.workspaceUnavailable"));
    assertFreshSignIn(session.session.createdAt, now());
    return Response.json(await run(db, session.user.id), { status, headers });
  } catch (error) {
    const response = error instanceof DiscoverValidationError ? Response.json({ error: error.message, details: error.details }, { status: error.status }) : errorResponse(error);
    Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }
}
export const platformBody = (request: Request) => readBoundedJson(request, 4_096, () => invalid("DISCOVER_REQUEST_TOO_LARGE")) as Promise<unknown>;
