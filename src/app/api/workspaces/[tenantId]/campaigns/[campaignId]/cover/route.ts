import { getDb } from "@/db/client";
import { getCampaignCoverUrl } from "@/server/campaign-wizard-cover";
import { errorResponse, verifiedUser } from "@/server/http";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
// A short-lived signed address for the campaign's cover, for anyone who can read the campaign.
export async function GET(request: Request, context: { params: Promise<{ tenantId: string; campaignId: string }> }) {
  try {
    const user = await verifiedUser(request);
    return Response.json(await getCampaignCoverUrl(getDb(), user, await context.params, getStorage), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
