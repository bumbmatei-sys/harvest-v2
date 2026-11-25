import { getDb } from "@/db/client";
import { createDraftCoverUpload } from "@/server/campaign-wizard-cover";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ tenantId: string; draftId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request);
    return Response.json(await createDraftCoverUpload(getDb(), user, await context.params, await request.json(), getStorage), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
