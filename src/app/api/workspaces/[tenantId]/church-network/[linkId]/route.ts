import { getDb } from "@/db/client";
import { acceptChurchLink, churchNetworkSummary, unlinkChurch } from "@/server/church-network";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

type Context = { params: Promise<{ tenantId: string; linkId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await verifiedUser(request);
    const { tenantId, linkId } = await params;
    return Response.json(await churchNetworkSummary(getDb(), user, tenantId, linkId), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request);
    const { tenantId, linkId } = await params;
    return Response.json(await acceptChurchLink(getDb(), user, tenantId, linkId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request);
    const { tenantId, linkId } = await params;
    return Response.json(await unlinkChurch(getDb(), user, tenantId, linkId), { headers });
  } catch (error) { return errorResponse(error); }
}
