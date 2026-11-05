import { getDb } from "@/db/client";
import { listCompanyActivity } from "@/server/activity";
import { errorResponse, verifiedUser } from "@/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; companyId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, companyId } = await context.params;
    return Response.json(await listCompanyActivity(getDb(), user, tenantId, companyId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
