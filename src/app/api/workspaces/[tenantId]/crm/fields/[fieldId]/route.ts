import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { updateFieldDefinition } from "@/server/crm-fields";
type Context = { params: Promise<{ tenantId: string; fieldId: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, fieldId } = await context.params;
    return Response.json(await updateFieldDefinition(getDb(), user, tenantId, fieldId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
