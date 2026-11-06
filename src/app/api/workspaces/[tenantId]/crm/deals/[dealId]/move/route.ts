import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { moveDeal } from "@/server/crm-deals";
type Context = { params: Promise<{ tenantId: string; dealId: string }> };
/** Move a deal to another stage of its pipeline: { stageId, version, closedReason? }. */
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, dealId } = await context.params;
    return Response.json(await moveDeal(getDb(), user, tenantId, dealId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
