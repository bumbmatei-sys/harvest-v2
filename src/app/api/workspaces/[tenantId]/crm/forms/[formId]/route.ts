import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { getCrmForm, saveCrmForm } from "@/server/crm-forms";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; formId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, formId } = await context.params;
    return Response.json(await getCrmForm(getDb(), user, tenantId, formId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, formId } = await context.params;
    return Response.json(await saveCrmForm(getDb(), user, tenantId, formId, await request.json()), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
