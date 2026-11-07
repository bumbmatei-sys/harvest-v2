import { getDb } from "@/db/client";
import { errorResponse, verifiedUser } from "@/server/http";
import { listWebhookDeliveries } from "@/server/crm-webhooks";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; endpointId: string }> };
/** Owner/admin: recent delivery outcomes for one endpoint (codes and times only). */
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, endpointId } = await context.params;
    return Response.json(await listWebhookDeliveries(getDb(), user, tenantId, endpointId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
