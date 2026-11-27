import { getDb } from "@/db/client";
import { createRightsRequest, listRightsRequests, updateRightsRequest } from "@/server/crm-rights-requests";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await params;
    return Response.json(await listRightsRequests(getDb(), user, tenantId, new URL(request.url).searchParams.get("page")), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await params;
    return Response.json(await createRightsRequest(getDb(), user, tenantId, await request.json()), { status: 201, headers });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await params;
    return Response.json(await updateRightsRequest(getDb(), user, tenantId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
