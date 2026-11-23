import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { z } from "zod";
import { setNotificationPreferences } from "@/server/crm-tasks";
type Context = { params: Promise<{ tenantId: string }> };
const patch = z.object({ due: z.boolean().optional(), overdue: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0);
/** Turn my due or overdue task notices on or off in this ministry. */
export async function PUT(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await setNotificationPreferences(getDb(), user, tenantId, patch.parse(await request.json())), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
