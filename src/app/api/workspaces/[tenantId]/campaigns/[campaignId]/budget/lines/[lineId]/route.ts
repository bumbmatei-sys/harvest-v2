import { getDb } from "@/db/client";
import { deleteBudgetLine, updateBudgetLine } from "@/server/campaign-budget";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string; lineId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// Changes a budget line's planned amount, checked against the version it was loaded at.
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId, lineId } = await context.params;
    return Response.json(await updateBudgetLine(getDb(), user, tenantId, campaignId, lineId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId, lineId } = await context.params;
    return Response.json(await deleteBudgetLine(getDb(), user, tenantId, campaignId, lineId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
