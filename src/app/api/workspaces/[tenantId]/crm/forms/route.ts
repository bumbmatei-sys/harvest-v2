import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { createCrmForm, listCrmForms } from "@/server/crm-forms";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json({ forms: await listCrmForms(getDb(), user, tenantId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await createCrmForm(getDb(), user, tenantId, await request.json()), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
