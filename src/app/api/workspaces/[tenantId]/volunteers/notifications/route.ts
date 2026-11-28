import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { volunteerNotifications } from "@/server/volunteer-roster";

type Context = { params: Promise<{ tenantId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await verifiedUser(request);
    const { tenantId } = await params;
    return Response.json(await volunteerNotifications(getDb(), actor, tenantId), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    verifyOrigin(request);
    const actor = await verifiedUser(request);
    const { tenantId } = await params;
    return Response.json(await volunteerNotifications(getDb(), actor, tenantId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
