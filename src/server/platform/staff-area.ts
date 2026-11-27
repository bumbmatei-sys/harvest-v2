import type { Database } from "../../db/client";
import { getDb } from "../../db/client";
import { message } from "../../i18n/messages";
import { getAuth } from "../auth-instance";
import { errorResponse, verifyOrigin } from "../http";
import { AccessError } from "../permissions";
import { readBoundedJson } from "../request-json";
import { withUser } from "../tenancy";
import { assertFreshSignIn, staffRole } from "./staff";

// Shared by the Harvest staff areas that review visitor reports (Ways to give, Communities): the platform_staff role, a sign-in within 15 minutes and
// a neutral 404 for everyone else. Every database function they call re-checks the active staff role and writes a staff audit row.
export const staffNotFound = () => new AccessError(404, message("Errors.workspaceUnavailable"));
export const staffInvalid = () => new AccessError(400, message("Errors.checkTheSuppliedDetails"));
function isNotStaff(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === "P0001" && typeof e.message === "string" && e.message.includes("not staff")) return true;
  return isNotStaff(e.cause);
}
/** Runs as the signed-in user; a database "not staff" refusal becomes the neutral 404. */
export async function asStaff<T>(db: Database, user: string, run: (tx: Parameters<Parameters<typeof withUser>[2]>[0]) => Promise<T>) {
  try { return await withUser(db, user, run); } catch (error) { if (isNotStaff(error)) throw staffNotFound(); throw error; }
}

const headers = { "Cache-Control": "private, no-store" };
/** Staff route wrapper: off with the area's switch, origin on writes, a session, a sign-in within 15 minutes and an active staff role; anyone else gets a neutral 404. */
export async function staffAreaResponse(enabled: () => boolean, request: Request, write: boolean, run: (db: Database, user: string) => Promise<unknown>, now = () => new Date()) {
  try {
    if (!enabled()) throw staffNotFound();
    if (write) verifyOrigin(request);
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) throw new AccessError(401, message("Errors.signInToContinue"));
    const db = getDb();
    if (!(await staffRole(db, session.user.id))) throw staffNotFound();
    assertFreshSignIn(session.session.createdAt, now());
    return Response.json(await run(db, session.user.id), { headers });
  } catch (error) {
    const response = errorResponse(error);
    Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }
}
export const staffAreaBody = (request: Request) => readBoundedJson(request, 4_096, staffInvalid) as Promise<unknown>;
