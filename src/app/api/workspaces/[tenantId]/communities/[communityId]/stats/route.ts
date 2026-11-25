import { getDb } from "@/db/client";
import { getCommunityStats } from "@/server/community-stats";
import { communitiesEnabled } from "@/server/communities-mode";
import { errorResponse, verifiedUser } from "@/server/http";

export const runtime = "nodejs";
// Read-only aggregates for owners and admins. Same Communities gate as every other community route; nothing is written, sent or exported.
export async function GET(request: Request, context: { params: Promise<{ tenantId: string; communityId: string }> }) {
  if (!communitiesEnabled()) return new Response(null, { status: 404 });
  try {
    const user = await verifiedUser(request), { tenantId, communityId } = await context.params;
    return Response.json(await getCommunityStats(getDb(), user, tenantId, communityId, new URL(request.url).searchParams.get("period") ?? "last30"), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
