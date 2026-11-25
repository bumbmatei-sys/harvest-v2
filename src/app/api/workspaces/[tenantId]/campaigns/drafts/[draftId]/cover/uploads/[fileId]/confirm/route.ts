import { getDb } from "@/db/client";
import { confirmDraftCoverUpload } from "@/server/campaign-wizard-cover";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ tenantId: string; draftId: string; fileId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), params = await context.params;
    return Response.json(await confirmDraftCoverUpload(getDb(), user, params, params.fileId, getStorage), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
