import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { updatePipeline } from "@/server/crm-deals";
type Context = { params: Promise<{ tenantId: string; pipelineId: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, pipelineId } = await context.params;
    return Response.json(await updatePipeline(getDb(), user, tenantId, pipelineId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
