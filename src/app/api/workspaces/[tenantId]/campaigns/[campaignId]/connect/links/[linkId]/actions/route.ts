import { getDb } from "@/db/client";
import { transitionConnectLink } from "@/server/connect-links";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";

// Publish, disable, archive or rotate one link (owner/admin; see connect_link_transition).
export async function POST(request: Request, context: { params: Promise<{ tenantId: string; campaignId: string; linkId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId, linkId } = await context.params;
    return Response.json(await transitionConnectLink(getDb(), user, tenantId, campaignId, linkId, await request.json()), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
