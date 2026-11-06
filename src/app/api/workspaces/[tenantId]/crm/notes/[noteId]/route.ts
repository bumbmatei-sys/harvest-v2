import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { updateNote } from "@/server/crm-tasks";
type Context = { params: Promise<{ tenantId: string; noteId: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, noteId } = await context.params;
    return Response.json(await updateNote(getDb(), user, tenantId, noteId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
