import { getDb } from "@/db/client";
import { errorResponse, verifiedUser } from "@/server/http";
import { sourceOptions } from "@/server/crm-sources";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await sourceOptions(getDb(), user, tenantId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
