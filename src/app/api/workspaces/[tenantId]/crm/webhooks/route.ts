import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { createWebhookEndpoint, listWebhookEndpoints } from "@/server/crm-webhooks";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
const noStore = { "Cache-Control": "private, no-store" };
/** Owner/admin: the workspace's CRM webhook endpoints (no secrets). */
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await listWebhookEndpoints(getDb(), user, tenantId), { headers: noStore });
  } catch (error) { return errorResponse(error); }
}
/** Owner/admin: register an endpoint. The response carries the signing secret once. */
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await createWebhookEndpoint(getDb(), user, tenantId, await request.json()), { status: 201, headers: noStore });
  } catch (error) { return errorResponse(error); }
}
