import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { readMinistryProfile, saveMinistryProfile } from "@/server/ministry-profile";

type Context = { params: Promise<{ tenantId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await verifiedUser(request);
    const { tenantId } = await params;
    return Response.json(await readMinistryProfile(getDb(), user, tenantId), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request);
    const { tenantId } = await params;
    return Response.json(await saveMinistryProfile(getDb(), user, tenantId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
