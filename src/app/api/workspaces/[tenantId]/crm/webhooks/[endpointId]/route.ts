import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { deleteWebhookEndpoint, updateWebhookEndpoint } from "@/server/crm-webhooks";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; endpointId: string }> };
const noStore = { "Cache-Control": "private, no-store" };
/** Owner/admin: change destination, event types or status, or rotate the secret (returned once). */
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, endpointId } = await context.params;
    return Response.json(await updateWebhookEndpoint(getDb(), user, tenantId, endpointId, await request.json()), { headers: noStore });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, endpointId } = await context.params;
    return Response.json(await deleteWebhookEndpoint(getDb(), user, tenantId, endpointId), { headers: noStore });
  } catch (error) { return errorResponse(error); }
}
