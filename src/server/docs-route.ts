import { getDb } from "@/db/client";
import { errorResponse, verifiedSessionUser, verifyOrigin } from "./http";
import { docsEnabled } from "./docs";

/** Shared wrapper of the Docs routes: 404 while the module is off, a verified session, the same-origin check on writes, no caching. */
export function docsRoute<P>(run: (args: { db: ReturnType<typeof getDb>; user: string; params: P; body: unknown; request: Request }) => Promise<unknown>, write: boolean) {
  return async (request: Request, context: { params: Promise<P> }) => {
    if (!docsEnabled()) return new Response(null, { status: 404 });
    try {
      if (write) verifyOrigin(request);
      const sessionUser = await verifiedSessionUser(request), params = await context.params;
      const text = write ? await request.text() : "", body = text ? JSON.parse(text) : undefined;
      return Response.json(await run({ db: getDb(), user: sessionUser.id, params, body, request }), { headers: { "Cache-Control": "private, no-store" } });
    } catch (e) { return errorResponse(e); }
  };
}
export const docsQuery = (request: Request) => Object.fromEntries(new URL(request.url).searchParams.entries());
