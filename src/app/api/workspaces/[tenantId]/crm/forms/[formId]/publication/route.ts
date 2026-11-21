import { getDb } from "@/db/client";
import { transitionCrmForm } from "@/server/crm-form-publication";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { readBoundedJson } from "@/server/request-json";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ tenantId: string; formId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request);
    const { tenantId, formId } = await context.params;
    const inData = await readBoundedJson(request, 1024);
    return Response.json(await transitionCrmForm(getDb(), user, tenantId, formId, inData), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
