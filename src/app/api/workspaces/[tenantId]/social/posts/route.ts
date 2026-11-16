import { getDb } from "@/db/client";
import { errorResponse, searchParamsRecord, verifiedUser, verifyOrigin } from "@/server/http";
import { listPosts, schedulePost } from "@/server/social/service";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
const noStore = { "Cache-Control": "private, no-store" };
/** Owner/admin: the ministry's social posts. */
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params, query = searchParamsRecord(request.url);
    return Response.json(await listPosts(getDb(), user, tenantId, { status: typeof query.status === "string" ? query.status : undefined, page: typeof query.page === "string" ? Number(query.page) : undefined }), { headers: noStore });
  } catch (error) { return errorResponse(error); }
}
/** Owner/admin: create a draft, or schedule a post. Nothing is sent here. */
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await schedulePost(getDb(), user, tenantId, await request.json()), { status: 201, headers: noStore });
  } catch (error) { return errorResponse(error); }
}
