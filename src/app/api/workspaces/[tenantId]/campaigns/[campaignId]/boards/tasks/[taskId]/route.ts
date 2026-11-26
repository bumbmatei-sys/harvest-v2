import { getDb } from "@/db/client";
import { deleteCampaignTask, updateCampaignTask } from "@/server/campaign-boards";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string; taskId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// Edits or moves a task (board, column, position), checked against the version it was loaded at.
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId, taskId } = await context.params;
    return Response.json(await updateCampaignTask(getDb(), user, tenantId, campaignId, taskId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId, taskId } = await context.params;
    return Response.json(await deleteCampaignTask(getDb(), user, tenantId, campaignId, taskId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
