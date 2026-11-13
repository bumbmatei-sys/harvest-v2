import { getDb } from "@/db/client";
import { listPendingResponsePage } from "@/server/connect-responses";
import { errorResponse, verifiedUser } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string }> };

// Pending-response metadata for owners/admins (HC-DEC2 direction, not an activation approval). Every other role, and anyone
// outside the ministry, gets the same 403; each allowed read is audited with a count only.
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    // limit: integer >= 1 (default 50, clamped to 200); cursor: opaque token from the previous page's nextCursor. Malformed values are 400.
    const query = new URL(request.url).searchParams, limit = query.get("limit"), cursor = query.get("cursor");
    if (limit !== null && !/^\d{1,9}$/.test(limit)) throw new SyntaxError();
    return Response.json(await listPendingResponsePage(getDb(), user, tenantId, campaignId, { limit: limit === null ? undefined : Number(limit), cursor: cursor ?? undefined }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
