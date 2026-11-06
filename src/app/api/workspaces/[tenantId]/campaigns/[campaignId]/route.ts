import { getDb } from "@/db/client";
import { getCampaign } from "@/server/campaigns";
import { errorResponse, verifiedUser } from "@/server/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ tenantId: string; campaignId: string }> }) {
  try {
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json(await getCampaign(getDb(), user, tenantId, campaignId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
