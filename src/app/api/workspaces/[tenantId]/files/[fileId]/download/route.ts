import { getDb } from "@/db/client";
import { errorResponse, verifiedUser } from "@/server/http";
import { fileDownload } from "@/server/files/service";
import { getStorage } from "@/server/storage";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ tenantId: string; fileId: string }> }) {
  try {
    const userId = await verifiedUser(request);
    const { tenantId, fileId } = await context.params;
    return Response.json(await fileDownload(getDb(), getStorage(), userId, tenantId, fileId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
