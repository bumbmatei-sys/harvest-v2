import { getDb } from "@/db/client";
import { assignFollowUpCase, getFollowUpCase, transitionFollowUpCase } from "@/server/follow-up-cases";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; caseId: string }> };
const headers = { "Cache-Control": "private, no-store" };

/** Owner/admin: any case (404 when unknown). Assigned member: their own open case. Everyone else, and unknown ids for a member: the same 403. */
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, caseId } = await context.params;
    return Response.json(await getFollowUpCase(getDb(), user, tenantId, caseId), { headers });
  } catch (error) { return errorResponse(error); }
}

/**
 * { assigneeId, version } assigns or reassigns (null unassigns): owner/admin only.
 * { to, version } moves the case through its guarded lifecycle: owner/admin any legal move, the assigned member contact progress only.
 */
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, caseId } = await context.params;
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new SyntaxError();
    const result = "assigneeId" in body ? await assignFollowUpCase(getDb(), user, tenantId, caseId, body) : await transitionFollowUpCase(getDb(), user, tenantId, caseId, body);
    return Response.json(result, { headers });
  } catch (error) { return errorResponse(error); }
}
