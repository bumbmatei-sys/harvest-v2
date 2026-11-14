import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { cancelPost, getPost, reschedulePost, retryPost } from "@/server/social/service";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; postId: string }> };
const noStore = { "Cache-Control": "private, no-store" };
const patch = z.union([z.object({ retry: z.literal(true) }).strict(), z.object({ scheduledFor: z.string().nullable() }).strict()]);
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, postId } = await context.params;
    return Response.json(await getPost(getDb(), user, tenantId, postId), { headers: noStore });
  } catch (error) { return errorResponse(error); }
}
/** Owner/admin: set or clear the time of a draft/scheduled post, or retry a failed one. */
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, postId } = await context.params, body = patch.parse(await request.json());
    return Response.json("retry" in body ? await retryPost(getDb(), user, tenantId, postId) : await reschedulePost(getDb(), user, tenantId, postId, body), { headers: noStore });
  } catch (error) { return errorResponse(error); }
}
/** Owner/admin: cancel a draft, scheduled or failed post. */
export async function DELETE(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, postId } = await context.params;
    return Response.json(await cancelPost(getDb(), user, tenantId, postId), { headers: noStore });
  } catch (error) { return errorResponse(error); }
}
