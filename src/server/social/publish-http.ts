import { getDb, type Database } from "../../db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "../http";
import { socialRouteDeps } from "../social-publish-gate";
import { PublishValidationError } from "./publish-access";
import { assertEnabled, type SocialDeps } from "./registry";

export function publishResponse<P>(request: Request, context: { params: Promise<P> }, write: boolean,
  run: (db: Database, user: string, params: P, deps: SocialDeps) => Promise<unknown>, status = 200) {
  return (async () => {
    try {
      const deps = socialRouteDeps();
      assertEnabled(deps);
      if (write) verifyOrigin(request);
      const user = await verifiedUser(request);
      return Response.json(await run(getDb(), user, await context.params, deps), { status, headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      const response = error instanceof PublishValidationError
        ? Response.json({ error: error.message, details: error.details }, { status: error.status })
        : errorResponse(error);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
  })();
}
