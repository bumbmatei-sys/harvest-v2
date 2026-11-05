import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { patchRecordFields } from "@/server/crm-fields";
type Context = { params: Promise<{ tenantId: string; contactId: string }> };
// Custom field values, guarded by the record's version like built-in inline edits.
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, contactId } = await context.params;
    return Response.json(await patchRecordFields(getDb(), user, tenantId, "person", contactId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
