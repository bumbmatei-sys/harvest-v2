import { getDb } from "@/db/client";
import { getLanding, writeLanding } from "@/server/connect-landing";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { landingBody } from "@/server/connect-landing-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string; campaignId: string; linkId: string }> };
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, campaignId, linkId } = await context.params;
    return Response.json(await getLanding(getDb(), user, tenantId, campaignId, linkId), { headers });
  } catch (error) { const response = errorResponse(error); response.headers.set("Cache-Control", "private, no-store"); return response; }
}
export async function PUT(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId, linkId } = await context.params;
    return Response.json(await writeLanding(getDb(), user, tenantId, campaignId, linkId, await landingBody(request)), { headers });
  } catch (error) { const response = errorResponse(error); response.headers.set("Cache-Control", "private, no-store"); return response; }
}
