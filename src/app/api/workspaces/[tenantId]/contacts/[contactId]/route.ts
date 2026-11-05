import { getDb } from "@/db/client";
import { getContact, patchContact } from "@/server/contacts";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; contactId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, contactId } = await context.params;
    return Response.json(await getContact(getDb(), user, tenantId, contactId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
// Partial update guarded by the record version the editor last saw.
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, contactId } = await context.params;
    return Response.json(await patchContact(getDb(), user, tenantId, contactId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
