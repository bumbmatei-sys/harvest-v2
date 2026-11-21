import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { duplicateCrmForm } from "@/server/crm-forms";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ tenantId: string; formId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, formId } = await context.params;
    return Response.json(await duplicateCrmForm(getDb(), user, tenantId, formId), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
