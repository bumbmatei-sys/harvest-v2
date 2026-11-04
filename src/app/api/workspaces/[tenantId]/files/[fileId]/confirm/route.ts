import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { confirmUpload } from "@/server/files/service";
import { getStorage } from "@/server/storage";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ tenantId: string; fileId: string }> }) {
  try {
    verifyOrigin(request);
    const userId = await verifiedUser(request);
    const { tenantId, fileId } = await context.params;
    return Response.json(await confirmUpload(getDb(), getStorage(), userId, tenantId, fileId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
