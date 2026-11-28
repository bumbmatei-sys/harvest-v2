import { getDb } from "@/db/client";
import { listChurchLinks, requestChurchLink } from "@/server/church-network";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

type Context = { params: Promise<{ tenantId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await verifiedUser(request);
    const { tenantId } = await params;
    return Response.json(await listChurchLinks(getDb(), user, tenantId), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request);
    const { tenantId } = await params;
    return Response.json(await requestChurchLink(getDb(), user, tenantId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
