import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { refreshConnectionHealth, setConnectionEnabled } from "@/server/social/service";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; connectionId: string }> };
const noStore = { "Cache-Control": "private, no-store" };
const patch = z.union([z.object({ enabled: z.boolean() }).strict(), z.object({ refreshHealth: z.literal(true) }).strict()]);
/** Owner/admin: enable, disable, or re-check one linked account. */
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, connectionId } = await context.params, body = patch.parse(await request.json());
    return Response.json("enabled" in body ? await setConnectionEnabled(getDb(), user, tenantId, connectionId, body.enabled) : await refreshConnectionHealth(getDb(), user, tenantId, connectionId), { headers: noStore });
  } catch (error) { return errorResponse(error); }
}
