import { getDb } from "@/db/client";
import { createCampaignTask } from "@/server/campaign-boards";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// Adds a task to one of the campaign's boards. Nothing is sent or published.
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json(await createCampaignTask(getDb(), user, tenantId, campaignId, await request.json()), { status: 201, headers });
  } catch (error) { return errorResponse(error); }
}
