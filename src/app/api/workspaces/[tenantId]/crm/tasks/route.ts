import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { AccessError } from "@/server/permissions";
import { message } from "@/i18n/messages";
import { parseTaskQuery } from "@/lib/crm-tasks";
import { searchParamsRecord } from "@/server/http";
import { createTask, listTasks } from "@/server/crm-tasks";
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    const query = parseTaskQuery(searchParamsRecord(request.url));
    if (!query.success) throw new AccessError(400, message("Errors.thisViewHasSettingsThatAreNoLongerValid"), { reason: "invalid_view" });
    return Response.json(await listTasks(getDb(), user, tenantId, query.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await createTask(getDb(), user, tenantId, await request.json()), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
