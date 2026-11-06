import { getDb } from "@/db/client";
import { errorResponse, searchParamsRecord, verifiedUser } from "@/server/http";
import { exportCount } from "@/server/crm-export";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    const { entity, ...params } = searchParamsRecord(request.url);
    return Response.json(await exportCount(getDb(), user, tenantId, entity === "company" ? "company" : "person", params), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
