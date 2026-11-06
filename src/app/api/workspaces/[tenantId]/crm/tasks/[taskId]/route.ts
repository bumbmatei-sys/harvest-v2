import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { getTask, updateTask } from "@/server/crm-tasks";
type Context = { params: Promise<{ tenantId: string; taskId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, taskId } = await context.params;
    return Response.json(await getTask(getDb(), user, tenantId, taskId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
/** Edit, complete/reopen ({ status }), reassign, re-link or archive, with { version }. */
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, taskId } = await context.params;
    return Response.json(await updateTask(getDb(), user, tenantId, taskId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
