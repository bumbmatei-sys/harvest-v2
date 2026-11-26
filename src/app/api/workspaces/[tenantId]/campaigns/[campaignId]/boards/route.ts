import { getDb } from "@/db/client";
import { getCampaignBoards } from "@/server/campaign-boards";
import { errorResponse, verifiedUser } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// The campaign's boards, tasks and milestones. Readable by everyone who can read campaigns; `writable` says whether this person can change them.
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json(await getCampaignBoards(getDb(), user, tenantId, campaignId), { headers });
  } catch (error) { return errorResponse(error); }
}
