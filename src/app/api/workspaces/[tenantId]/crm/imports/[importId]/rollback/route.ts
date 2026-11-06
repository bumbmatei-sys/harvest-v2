import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { rollbackImport } from "@/server/crm-imports";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; importId: string }> };
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, importId } = await context.params;
    return Response.json(await rollbackImport(getDb(), user, tenantId, importId));
  } catch (error) { return errorResponse(error); }
}
