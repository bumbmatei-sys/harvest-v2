import { getDb } from "@/db/client";
import { getDraftCoverUrl, setDraftCover } from "@/server/campaign-wizard-cover";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; draftId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// A short-lived signed address for the draft's cover.
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request);
    return Response.json(await getDraftCoverUrl(getDb(), user, await context.params, getStorage), { headers });
  } catch (error) { return errorResponse(error); }
}

// Choose or clear the cover: { fileId, version }. A stale version is a 409.
export async function PUT(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request);
    return Response.json(await setDraftCover(getDb(), user, await context.params, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
