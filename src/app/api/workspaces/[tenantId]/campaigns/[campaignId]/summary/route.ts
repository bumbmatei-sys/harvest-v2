import { getDb } from "@/db/client";
import { campaignSummary } from "@/server/dashboard-data";
import { errorResponse, verifiedUser } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const actor = await verifiedUser(request);
    const { tenantId, campaignId } = await context.params;
    return Response.json(await campaignSummary(getDb(), actor, tenantId, campaignId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
