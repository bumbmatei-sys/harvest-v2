import { getDb } from "@/db/client";
import { revokeInvitation } from "@/server/campaign-wizard-invitations";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ tenantId: string; draftId: string; invitationId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, draftId, invitationId } = await context.params;
    return Response.json(await revokeInvitation(getDb(), user, tenantId, draftId, invitationId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
