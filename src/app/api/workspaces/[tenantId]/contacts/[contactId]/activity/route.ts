import { getDb } from "@/db/client";
import { listContactActivity } from "@/server/activity";
import { errorResponse, verifiedUser } from "@/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; contactId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, contactId } = await context.params;
    return Response.json(await listContactActivity(getDb(), user, tenantId, contactId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
