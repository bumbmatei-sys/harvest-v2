import { getDb } from "@/db/client";
import { errorResponse, searchParamsRecord, verifiedUser } from "@/server/http";
import { exportRecords } from "@/server/crm-export";
import { csvResponse } from "@/server/csv-response";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
/** GET ?entity=person|company plus the list's own view parameters (q, f, sort, view...). */
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    const { entity, ...params } = searchParamsRecord(request.url);
    const file = await exportRecords(getDb(), user, tenantId, entity === "company" ? "company" : "person", params);
    return csvResponse(file.fileName, file.body);
  } catch (error) { return errorResponse(error); }
}
