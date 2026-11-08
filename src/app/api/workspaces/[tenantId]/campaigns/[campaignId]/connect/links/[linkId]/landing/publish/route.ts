import { getDb } from "@/db/client";
import { writeLanding } from "@/server/connect-landing";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { landingBody } from "@/server/connect-landing-http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ tenantId: string; campaignId: string; linkId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId, linkId } = await context.params;
    return Response.json(await writeLanding(getDb(), user, tenantId, campaignId, linkId, await landingBody(request), true), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { const response = errorResponse(error); response.headers.set("Cache-Control", "private, no-store"); return response; }
}
