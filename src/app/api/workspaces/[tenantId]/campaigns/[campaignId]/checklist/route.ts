import { getDb } from "@/db/client";
import { getChecklist, setChecklistItem } from "@/server/campaign-checklist";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json({ items: await getChecklist(getDb(), user, tenantId, campaignId) }, { headers });
  } catch (error) { return errorResponse(error); }
}
// Ticks or unticks one item. State only: nothing is created, published or sent.
export async function PUT(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json({ items: await setChecklistItem(getDb(), user, tenantId, campaignId, await request.json()) }, { headers });
  } catch (error) { return errorResponse(error); }
}
