import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { getDeal, updateDeal } from "@/server/crm-deals";
type Context = { params: Promise<{ tenantId: string; dealId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, dealId } = await context.params;
    return Response.json(await getDeal(getDb(), user, tenantId, dealId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, dealId } = await context.params;
    return Response.json(await updateDeal(getDb(), user, tenantId, dealId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
