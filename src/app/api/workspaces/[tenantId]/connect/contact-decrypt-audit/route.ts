import { getDb } from "@/db/client";
import { listContactDecryptAudit } from "@/server/connect-decrypt-audit";
import { errorResponse, verifiedUser } from "@/server/http";

export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const user = await verifiedUser(request);
    const { tenantId } = await params;
    const query = new URL(request.url).searchParams;
    const time = query.get("before");
    const id = query.get("beforeId");
    const result = await listContactDecryptAudit(getDb(), user, tenantId, time || id ? [time, id] : null);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
