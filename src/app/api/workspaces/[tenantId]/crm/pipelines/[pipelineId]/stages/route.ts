import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { createStage, reorderStages } from "@/server/crm-deals";
type Context = { params: Promise<{ tenantId: string; pipelineId: string }> };
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, pipelineId } = await context.params;
    return Response.json(await createStage(getDb(), user, tenantId, pipelineId, await request.json()), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
/** Reorder: the body lists every live stage id in the new order. */
export async function PUT(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, pipelineId } = await context.params;
    return Response.json(await reorderStages(getDb(), user, tenantId, pipelineId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
