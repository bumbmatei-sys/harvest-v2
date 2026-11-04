import { getDb } from "@/db/client";
import { getContact, updateContact } from "@/server/contacts";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; contactId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, contactId } = await context.params;
    return Response.json(await getContact(getDb(), user, tenantId, contactId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, contactId } = await context.params;
    return Response.json(await updateContact(getDb(), user, tenantId, contactId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
