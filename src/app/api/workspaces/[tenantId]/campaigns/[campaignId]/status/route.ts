import { getDb } from "@/db/client";
import { setCampaignStatus } from "@/server/campaign-wizard";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
// State only: activating or returning a campaign to draft publishes and sends nothing.
export async function POST(request: Request, context: { params: Promise<{ tenantId: string; campaignId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json(await setCampaignStatus(getDb(), user, tenantId, campaignId, await request.json()), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
