import { getDb } from "@/db/client";
import { revokeInvite } from "@/server/communities";
import { communitiesEnabled } from "@/server/communities-mode";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
export async function DELETE(request: Request, context: { params: Promise<{ tenantId: string; communityId: string; inviteId: string }> }) {
  if (!communitiesEnabled()) return new Response(null, { status: 404 });
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, communityId, inviteId } = await context.params;
    await revokeInvite(getDb(), user, tenantId, communityId, inviteId, await request.json());
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
