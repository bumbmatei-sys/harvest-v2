import { getDb } from "@/db/client";
import { getCompany, patchCompany } from "@/server/companies";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; companyId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, companyId } = await context.params;
    return Response.json(await getCompany(getDb(), user, tenantId, companyId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, companyId } = await context.params;
    return Response.json(await patchCompany(getDb(), user, tenantId, companyId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
