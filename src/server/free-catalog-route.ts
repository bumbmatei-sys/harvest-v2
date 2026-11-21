import { workerSettings } from "./worker-settings";
import { getDb, type Database } from "../db/client";
import { freeCatalogEnabled } from "./free-catalog-mode";
import { errorResponse, verifiedUser, verifyOrigin } from "./http";

export function catalogRoute<P>(
  handle: (db: Database, user: string, params: P, request: Request) => Promise<unknown>,
  mode: "public" | "read" | "write",
) {
  return async (request: Request, context: { params: Promise<P> }) => {
    if (!freeCatalogEnabled(workerSettings.getStore()?.features)) return new Response(null, { status: 404 });
    try {
      if (mode === "write") verifyOrigin(request);
      const user = mode === "public" ? "" : await verifiedUser(request);
      const result = await handle(getDb(), user, await context.params, request);
      return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) { return errorResponse(error); }
  };
}
