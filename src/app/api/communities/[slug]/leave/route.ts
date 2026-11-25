import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { leaveCommunity } from "@/server/community-joining";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  if (!communitiesEnabled()) return new Response(null, { status: 404 });
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { slug } = await context.params;
    return Response.json(await leaveCommunity(getDb(), user, slug, await request.json().catch(() => ({}))));
  } catch (error) { return errorResponse(error); }
}
