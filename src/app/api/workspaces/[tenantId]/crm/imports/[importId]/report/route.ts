import { getDb } from "@/db/client";
import { errorResponse, verifiedUser } from "@/server/http";
import { importReport } from "@/server/crm-imports";
import { csvResponse } from "@/server/csv-response";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; importId: string }> };
/** CSV of the rows that were not imported, with the original cells and the reason. */
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, importId } = await context.params;
    const report = await importReport(getDb(), user, tenantId, importId);
    return csvResponse(report.fileName, report.body);
  } catch (error) { return errorResponse(error); }
}
