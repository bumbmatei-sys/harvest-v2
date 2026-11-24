import { getDb } from "@/db/client";
import { getDraft, saveDraftStep } from "@/server/campaign-wizard";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; draftId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, draftId } = await context.params;
    return Response.json(await getDraft(getDb(), user, tenantId, draftId), { headers });
  } catch (error) { return errorResponse(error); }
}

// Autosave one step: { version, step, data }. A stale version is a 409.
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, draftId } = await context.params;
    return Response.json(await saveDraftStep(getDb(), user, tenantId, draftId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
