import { getDb } from "@/db/client";
import { errorResponse, verifiedSessionUser, verifyOrigin } from "./http";
import { waysToGiveEnabled } from "./ways-to-give-mode";

/** Shared wrapper of the Ways to give owner routes: 404 while the module is off, a verified session, the same-origin check on writes, no caching. */
export function givingRoute<P>(run: (args: { db: ReturnType<typeof getDb>; user: string; params: P; body: unknown }) => Promise<unknown>, write: boolean) {
  return async (request: Request, context: { params: Promise<P> }) => {
    if (!waysToGiveEnabled()) return new Response(null, { status: 404 });
    try {
      if (write) verifyOrigin(request);
      const sessionUser = await verifiedSessionUser(request), params = await context.params;
      const text = write ? await request.text() : "";
      if (text.length > 16 * 1024) return Response.json({ error: "body_too_large" }, { status: 413 });
      const body = text ? JSON.parse(text) : undefined;
      return Response.json(await run({ db: getDb(), user: sessionUser.id, params, body }), { headers: { "Cache-Control": "private, no-store" } });
    } catch (e) { return errorResponse(e); }
  };
}
