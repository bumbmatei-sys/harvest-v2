import { getDb } from "@/db/client";
import { listApplications } from "@/server/community-applications";
import { communitiesEnabled } from "@/server/communities-mode";
import { errorResponse, verifiedUser } from "@/server/http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ tenantId: string; communityId: string }> }) {
  if (!communitiesEnabled()) return new Response(null, { status: 404 });
  try {
    const user = await verifiedUser(request), { tenantId, communityId } = await context.params;
    const status = new URL(request.url).searchParams.get("status") === "all" ? "all" : "open";
    return Response.json(await listApplications(getDb(), user, tenantId, communityId, { status }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
