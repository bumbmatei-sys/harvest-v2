import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { revokeInvitation } from "@/server/access";
export async function DELETE(request: Request, context: { params: Promise<{ tenantId: string; invitationId: string }> }) {
  try {
    verifyOrigin(request);
    const userId = await verifiedUser(request);
    const { tenantId, invitationId } = await context.params;
    return Response.json(await revokeInvitation(getDb(), userId, z.uuid().parse(tenantId), invitationId));
  } catch (error) { return errorResponse(error); }
}
