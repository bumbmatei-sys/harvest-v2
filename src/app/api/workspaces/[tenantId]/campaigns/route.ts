import { getDb } from "@/db/client";
import { createCampaign, listCampaigns } from "@/server/campaigns";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await listCampaigns(getDb(), user, tenantId, new URL(request.url).searchParams.get("page") ?? 1), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await createCampaign(getDb(), user, tenantId, await request.json(), request.headers.get("Idempotency-Key")), { status: 201, headers });
  } catch (error) { return errorResponse(error); }
}
