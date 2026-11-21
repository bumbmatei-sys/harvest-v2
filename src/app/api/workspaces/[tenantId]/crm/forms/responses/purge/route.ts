import { getDb } from "@/db/client";
import { purgeCrmFormResponses } from "@/server/crm-form-publication";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request);
    const { tenantId } = await context.params;
    return Response.json(await purgeCrmFormResponses(getDb(), user, tenantId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
