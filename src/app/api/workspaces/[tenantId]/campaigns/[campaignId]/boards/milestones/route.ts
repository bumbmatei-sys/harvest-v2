import { getDb } from "@/db/client";
import { createCampaignMilestone } from "@/server/campaign-boards";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// Adds a milestone to the campaign, or to one of its boards.
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json(await createCampaignMilestone(getDb(), user, tenantId, campaignId, await request.json()), { status: 201, headers });
  } catch (error) { return errorResponse(error); }
}
