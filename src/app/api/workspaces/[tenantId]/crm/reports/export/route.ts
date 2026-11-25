import { getDb } from "@/db/client";
import { exportCrmReportTable } from "@/server/crm-reports-export";
import { csvResponse } from "@/server/csv-response";
import { errorResponse, verifiedUser } from "@/server/http";

export const runtime = "nodejs";

type Context = { params: Promise<{ tenantId: string }> };

/** GET ?table=deals|tasks|sources|stages&period=: one report table as CSV for owners and admins (aggregates only, audited). */
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params, params = new URL(request.url).searchParams;
    const file = await exportCrmReportTable(getDb(), user, tenantId, params.get("period") ?? "last30", params.get("table") ?? "");
    return csvResponse(file.fileName, file.body);
  } catch (error) { return errorResponse(error); }
}
