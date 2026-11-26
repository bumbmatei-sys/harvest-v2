import { getDb } from "@/db/client";
import { getCampaignBudget } from "@/server/campaign-budget";
import { errorResponse, verifiedUser } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// The campaign budget: planned and spent by category for everyone who can read campaigns; individual expenses for owners and admins.
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json(await getCampaignBudget(getDb(), user, tenantId, campaignId), { headers });
  } catch (error) { return errorResponse(error); }
}
