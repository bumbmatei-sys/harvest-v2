import { getDb } from "@/db/client";
import { unlinkCompany, updateCompanyLink } from "@/server/contacts";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; contactId: string; companyId: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, contactId, companyId } = await context.params;
    return Response.json(await updateCompanyLink(getDb(), user, tenantId, contactId, companyId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, contactId, companyId } = await context.params;
    return Response.json(await unlinkCompany(getDb(), user, tenantId, contactId, companyId));
  } catch (error) { return errorResponse(error); }
}
