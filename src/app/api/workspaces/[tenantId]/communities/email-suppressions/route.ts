import { getDb } from "@/db/client";
import { communityEmailSuppressions, removeSoftCommunityEmailSuppression } from "@/server/community-email-feedback";
import { communitiesEnabled } from "@/server/communities-mode";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Params = { params: Promise<{ tenantId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: Params) {
  if (!communitiesEnabled()) return new Response(null, { status: 404, headers });
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await communityEmailSuppressions(getDb(), user, tenantId, new URL(request.url).searchParams.get("page")), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: Params) {
  if (!communitiesEnabled()) return new Response(null, { status: 404, headers });
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await removeSoftCommunityEmailSuppression(getDb(), user, tenantId, new URL(request.url).searchParams.get("id")), { headers });
  } catch (error) { return errorResponse(error); }
}
