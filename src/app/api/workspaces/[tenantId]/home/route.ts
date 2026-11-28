import { getDb } from "@/db/client";
import { workspaceHome } from "@/server/dashboard-data";
import { errorResponse, verifiedUser } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const actor = await verifiedUser(request);
    const { tenantId } = await context.params;
    return Response.json(await workspaceHome(getDb(), actor, tenantId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
