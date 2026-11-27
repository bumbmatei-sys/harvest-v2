import { getDb } from "@/db/client";
import { errorResponse, verifiedSessionUser, verifyOrigin } from "./http";
import { blogEnabled } from "./blog-mode";

/** Shared wrapper of the blog's owner routes: 404 while the module is off, a verified session, the same-origin check on writes, no caching. */
export function blogRoute<P>(run: (args: { db: ReturnType<typeof getDb>; user: string; params: P; body: unknown; request: Request }) => Promise<unknown>, write: boolean) {
  return async (request: Request, context: { params: Promise<P> }) => {
    if (!blogEnabled()) return new Response(null, { status: 404 });
    try {
      if (write) verifyOrigin(request);
      const sessionUser = await verifiedSessionUser(request), params = await context.params;
      const text = write ? await request.text() : "", body = text ? JSON.parse(text) : undefined;
      return Response.json(await run({ db: getDb(), user: sessionUser.id, params, body, request }), { headers: { "Cache-Control": "private, no-store" } });
    } catch (e) { return errorResponse(e); }
  };
}
