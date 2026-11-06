import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { updateStage } from "@/server/crm-deals";
type Context = { params: Promise<{ tenantId: string; stageId: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, stageId } = await context.params;
    return Response.json(await updateStage(getDb(), user, tenantId, stageId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
