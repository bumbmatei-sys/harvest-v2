import { getDb } from "@/db/client";
import { followUpCaseStates, type FollowUpCaseState } from "@/lib/follow-up-cases";
import { listFollowUpCases, openEligibleFollowUpCases } from "@/server/follow-up-cases";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// HC-13 server side. Owners/admins list every case; an assigned member lists only their own open cases (the database policy decides).
// limit: integer >= 1 (default 50, clamped to 200); cursor: the opaque nextCursor of the previous page; state: optional filter.
// Every denial is the same 403, and no total is ever returned.
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    const query = new URL(request.url).searchParams, limit = query.get("limit"), cursor = query.get("cursor"), state = query.get("state");
    if (limit !== null && !/^\d{1,9}$/.test(limit)) throw new SyntaxError();
    if (state !== null && !followUpCaseStates.includes(state as FollowUpCaseState)) throw new SyntaxError();
    return Response.json(await listFollowUpCases(getDb(), user, tenantId, { limit: limit === null ? undefined : Number(limit), cursor: cursor ?? undefined, state: (state as FollowUpCaseState | null) ?? undefined }), { headers });
  } catch (error) { return errorResponse(error); }
}

/** Owner/admin: open cases for verified associated responses whose follow-up consent is in effect. Body: optional { limit }. Idempotent. */
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    const text = await request.text();
    return Response.json(await openEligibleFollowUpCases(getDb(), user, tenantId, text.trim() ? JSON.parse(text) : {}), { headers });
  } catch (error) { return errorResponse(error); }
}
