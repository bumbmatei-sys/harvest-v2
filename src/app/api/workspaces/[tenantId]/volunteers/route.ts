import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { changeVolunteerRoster, getVolunteerRoster } from "@/server/volunteer-roster";

type Context = { params: Promise<{ tenantId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await verifiedUser(request);
    const { tenantId } = await params;
    const query = new URL(request.url).searchParams;
    return Response.json(await getVolunteerRoster(getDb(), user, tenantId, { from: query.get("from"), to: query.get("to") }), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request);
    const { tenantId } = await params;
    return Response.json(await changeVolunteerRoster(getDb(), user, tenantId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
