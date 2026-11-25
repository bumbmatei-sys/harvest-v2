import { getDb } from "@/db/client";
import { discardDraft } from "@/server/campaign-wizard";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ tenantId: string; draftId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, draftId } = await context.params;
    return Response.json(await discardDraft(getDb(), user, tenantId, draftId, await request.json()), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
