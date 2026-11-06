import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { AccessError } from "@/server/permissions";
import { message } from "@/i18n/messages";
import { parseDealQuery } from "@/lib/crm-deals";
import { searchParamsRecord } from "@/server/http";
import { createDeal, listDeals } from "@/server/crm-deals";
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    const raw = searchParamsRecord(request.url), query = parseDealQuery(raw);
    if (!query.success) throw new AccessError(400, message("Errors.thisViewHasSettingsThatAreNoLongerValid"), { reason: "invalid_view" });
    const pipeline = typeof raw.pipeline === "string" ? raw.pipeline : null;
    return Response.json(await listDeals(getDb(), user, tenantId, pipeline, query.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await createDeal(getDb(), user, tenantId, await request.json()), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
