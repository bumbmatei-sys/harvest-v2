import { getDb } from "@/db/client";
import { errorResponse, verifiedUser } from "@/server/http";
export const runtime = "nodejs";
import { getTimeline } from "@/server/activity";
type Context = { params: Promise<{ tenantId: string; companyId: string }> };
/** Unified timeline, newest first, 50 per page; pass ?before=<nextCursor> for the next page. */
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, companyId } = await context.params;
    return Response.json(await getTimeline(getDb(), user, tenantId, "company", companyId, new URL(request.url).searchParams.get("before")), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
