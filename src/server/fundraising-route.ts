import { getDb, type Database } from "../db/client";
import { fundraisingEnabled } from "./fundraising";
import { errorResponse, verifiedUser, verifyOrigin } from "./http";

/** Signed-in JSON route for the fundraising screens. Off (404) wherever the module is off, which includes production. */
export function fundraisingRoute<P>(handle: (db: Database, user: string, params: P, request: Request) => Promise<unknown>, mode: "read" | "write") {
  return async (request: Request, context: { params: Promise<P> }) => {
    if (!fundraisingEnabled()) return new Response(null, { status: 404 });
    try {
      if (mode === "write") verifyOrigin(request);
      const user = await verifiedUser(request);
      return Response.json(await handle(getDb(), user, await context.params, request), { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) { return errorResponse(error); }
  };
}
/** The client sends its retry key in this header so a repeated submit is the same record. */
export const idempotencyHeader = (request: Request) => request.headers.get("idempotency-key");
