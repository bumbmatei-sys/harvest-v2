import { getDb } from "@/db/client";
import { createConnectLink, listConnectLinks } from "@/server/connect-links";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json(await listConnectLinks(getDb(), user, tenantId, campaignId), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json(await createConnectLink(getDb(), user, tenantId, campaignId, await request.json()), { status: 201, headers });
  } catch (error) { return errorResponse(error); }
}
