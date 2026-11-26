import { getDb } from "@/db/client";
import { listCampaignEvents, setCampaignEvent } from "@/server/campaign-events";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// Campaign events: the linked events this person can see. 404 while Events is off.
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    const view = await listCampaignEvents(getDb(), user, tenantId, campaignId);
    return view ? Response.json(view, { headers }) : Response.json({}, { status: 404, headers });
  } catch (error) { return errorResponse(error); }
}
// Adds an existing event to the campaign or removes it ({ eventId, linked }). The event itself is not changed, published or announced.
export async function PUT(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json(await setCampaignEvent(getDb(), user, tenantId, campaignId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
