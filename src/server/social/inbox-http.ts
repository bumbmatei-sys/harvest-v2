import { getDb, type Database } from "../../db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "../http";
import { readBoundedJson } from "../request-json";
import { PublishValidationError, publishInvalid } from "./publish-access";
import { socialRouteDeps } from "../social-publish-gate";
import { assertEnabled, type SocialDeps } from "./registry";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function inboxResponse<P>(request: Request, context: { params: Promise<P> }, write: boolean,
  run: (db: Database, user: string, params: P, deps: SocialDeps) => Promise<object>, status = 200) {
  try {
    // The same dependencies as the Publish routes: the hard-off defaults, or the non-production fake provider while the screens gate is open.
    const deps = socialRouteDeps();
    assertEnabled(deps);
    if (write) verifyOrigin(request);
    const user = await verifiedUser(request);
    const result = await run(getDb(), user, await context.params, deps);
    const responseHeaders = new Headers(headers);
    if ("retryAfter" in result && typeof result.retryAfter === "number" && Number.isFinite(result.retryAfter)) {
      responseHeaders.set("Retry-After", String(result.retryAfter));
    }
    if ("etag" in result && typeof result.etag === "string") {
      responseHeaders.set("ETag", result.etag);
      if (request.headers.get("If-None-Match")?.split(",").some(tag => tag.trim().replace(/^W\//, "") === result.etag)) {
        return new Response(null, { headers: responseHeaders, status: 304 });
      }
    }
    return Response.json(result, { status, headers: responseHeaders });
  } catch (error) {
    const response = error instanceof PublishValidationError
      ? Response.json({ error: error.message, details: error.details }, { status: error.status })
      : errorResponse(error);
    Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  }
}

export function inboxJson(request: Request, max = 32_768): Promise<unknown> {
  return readBoundedJson(request, max, () => publishInvalid("INBOX_REQUEST_TOO_LARGE"));
}

export type InboxContext<T extends Record<string, string> = Record<never, never>> = {
  params: Promise<{ tenantId: string } & T>;
};
