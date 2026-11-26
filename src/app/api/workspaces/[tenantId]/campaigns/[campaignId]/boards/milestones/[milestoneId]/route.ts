import { getDb } from "@/db/client";
import { deleteCampaignMilestone, updateCampaignMilestone } from "@/server/campaign-boards";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string; milestoneId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// Edits a milestone or marks it reached / not reached, checked against the version it was loaded at.
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId, milestoneId } = await context.params;
    return Response.json(await updateCampaignMilestone(getDb(), user, tenantId, campaignId, milestoneId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
// Removes a milestone; its tasks stay and lose the link.
export async function DELETE(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId, milestoneId } = await context.params;
    return Response.json(await deleteCampaignMilestone(getDb(), user, tenantId, campaignId, milestoneId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
