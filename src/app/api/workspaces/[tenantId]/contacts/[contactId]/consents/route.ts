import { getDb } from "@/db/client";
import { recordConsent } from "@/server/contacts";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ tenantId: string; contactId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, contactId } = await context.params;
    return Response.json(await recordConsent(getDb(), user, tenantId, contactId, await request.json()), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
