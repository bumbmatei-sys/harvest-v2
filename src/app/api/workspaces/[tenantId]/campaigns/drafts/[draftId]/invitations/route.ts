import { getDb } from "@/db/client";
import { inviteToDraft, syntheticInvitationSink } from "@/server/campaign-wizard-invitations";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
// Invite someone to a department of the draft: { department, role, userId } or { department, role, email }. Nothing is sent from here (live delivery is off).
export async function POST(request: Request, context: { params: Promise<{ tenantId: string; draftId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, draftId } = await context.params;
    return Response.json(await inviteToDraft(getDb(), user, tenantId, draftId, await request.json(), syntheticInvitationSink), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
