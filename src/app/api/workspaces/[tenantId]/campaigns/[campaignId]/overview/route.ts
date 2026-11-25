import { getDb } from "@/db/client";
import { getCampaignOverview } from "@/server/campaign-overview";
import { errorResponse, verifiedUser } from "@/server/http";

export const runtime = "nodejs";
// Read only: the finished draft's configuration (departments, leaders, tools) and the checklist progress, for people who can write campaigns.
export async function GET(request: Request, context: { params: Promise<{ tenantId: string; campaignId: string }> }) {
  try {
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json(await getCampaignOverview(getDb(), user, tenantId, campaignId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
