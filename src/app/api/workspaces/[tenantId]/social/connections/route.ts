import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { linkConnection, listConnections } from "@/server/social/service";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
const noStore = { "Cache-Control": "private, no-store" };
/** Owner/admin: linked social accounts (never the credential). */
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await listConnections(getDb(), user, tenantId), { headers: noStore });
  } catch (error) { return errorResponse(error); }
}
/** Owner/admin: link an account. The credential is sealed before it is stored and never returned. */
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await linkConnection(getDb(), user, tenantId, await request.json()), { status: 201, headers: noStore });
  } catch (error) { return errorResponse(error); }
}
