import { getDb, type Database } from "../../db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "../http";
import { readBoundedJson } from "../request-json";
import { DiscoverValidationError, invalid } from "./owner";
import { discoverRouteDeps } from "./gate";
import { assertDiscoverEnabled, type DiscoverDeps } from "./registry";

const headers = { "Cache-Control": "private, no-store" };
/** Shared wrapper: hard-off check first, then origin and session for writes, one error shape. Public reads need no session. */
export async function discoverResponse(request: Request, opts: { write: boolean; session: boolean }, run: (db: Database, user: string, deps: DiscoverDeps) => Promise<unknown>, status = 200, deps: DiscoverDeps = discoverRouteDeps()) {
  try {
    assertDiscoverEnabled(deps);
    if (opts.write) verifyOrigin(request);
    const user = opts.session ? await verifiedUser(request) : "";
    return Response.json(await run(getDb(), user, deps), { status, headers });
  } catch (error) {
    const response = error instanceof DiscoverValidationError ? Response.json({ error: error.message, details: error.details }, { status: error.status }) : errorResponse(error);
    Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }
}
export const discoverBody = (request: Request) => readBoundedJson(request, 8_192, () => invalid("DISCOVER_REQUEST_TOO_LARGE")) as Promise<unknown>;
