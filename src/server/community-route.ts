import { getDb } from "@/db/client";
import { communitiesEnabled } from "./communities-mode";
import { errorResponse, verifiedUser, verifyOrigin } from "./http";

// Shared wrapper for Communities API routes: 404 while the flag is off (before authentication), origin check on writes,
// verified user, JSON in/out, never cached.
export function communityRoute<P>(run: (args: { db: ReturnType<typeof getDb>; user: string; params: P; body: unknown; request: Request }) => Promise<unknown>, options: { write: boolean }) {
  return async (request: Request, context: { params: Promise<P> }) => {
    if (!communitiesEnabled()) return new Response(null, { status: 404 });
    try {
      if (options.write) verifyOrigin(request);
      const user = await verifiedUser(request), params = await context.params;
      const body = options.write && request.headers.get("content-type")?.includes("application/json") ? await request.json() : undefined;
      const result = await run({ db: getDb(), user, params, body, request });
      if (result instanceof Response) return result;
      return Response.json(result ?? {}, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) { return errorResponse(error); }
  };
}
