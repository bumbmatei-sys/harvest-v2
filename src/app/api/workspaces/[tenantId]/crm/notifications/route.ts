import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { z } from "zod";
import { listNotifications, markNotificationsRead } from "@/server/crm-tasks";
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await listNotifications(getDb(), user, tenantId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
const markRead = z.object({ ids: z.union([z.literal("all"), z.array(z.uuid()).max(100)]) }).strict();
/** Mark the caller's own notifications read: { ids: [...] } or { ids: "all" }. */
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await markNotificationsRead(getDb(), user, tenantId, markRead.parse(await request.json()).ids));
  } catch (error) { return errorResponse(error); }
}
