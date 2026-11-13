import { getDb } from "@/db/client";
import { listPendingResponseSummaries } from "@/server/connect-responses";
import { errorResponse, verifiedUser } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string }> };

// Pending-response metadata for owners/admins (HC-DEC2 direction, not an activation approval). Every other role, and anyone
// outside the ministry, gets the same 403; each allowed read is audited with a count only.
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json(await listPendingResponseSummaries(getDb(), user, tenantId, campaignId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
