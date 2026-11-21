import { getDb } from "@/db/client";
import { listCrmFormResponses } from "@/server/crm-form-publication";
import { errorResponse, searchParamsRecord, verifiedUser } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ tenantId: string; formId: string }> }) {
  try {
    const user = await verifiedUser(request);
    const { tenantId, formId } = await context.params;
    const result = await listCrmFormResponses(getDb(), user, tenantId, formId, searchParamsRecord(request.url));
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
