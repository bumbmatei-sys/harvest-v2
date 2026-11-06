import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { getImport, rowOutcomes, updateImport, type RowOutcome } from "@/server/crm-imports";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; importId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, importId } = await context.params;
    const params = new URL(request.url).searchParams, outcome = params.get("outcome") ?? "all";
    return Response.json(await getImport(getDb(), user, tenantId, importId, {
      outcome: (rowOutcomes as readonly string[]).includes(outcome) ? outcome as RowOutcome : "all", page: Number(params.get("page")) || 1,
    }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, importId } = await context.params;
    return Response.json(await updateImport(getDb(), user, tenantId, importId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
