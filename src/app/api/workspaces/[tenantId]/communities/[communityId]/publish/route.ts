import { getDb } from "@/db/client";
import { publishCommunity } from "@/server/communities";
import { communitiesEnabled } from "@/server/communities-mode";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ tenantId: string; communityId: string }> }) {
  if (!communitiesEnabled()) return new Response(null, { status: 404 });
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, communityId } = await context.params;
    return Response.json(await publishCommunity(getDb(), user, tenantId, communityId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
