import { getDb } from "@/db/client";
import { decideApplication } from "@/server/community-applications";
import { communitiesEnabled } from "@/server/communities-mode";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ tenantId: string; communityId: string; applicationId: string }> }) {
  if (!communitiesEnabled()) return new Response(null, { status: 404 });
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, communityId, applicationId } = await context.params;
    return Response.json(await decideApplication(getDb(), user, tenantId, communityId, applicationId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
