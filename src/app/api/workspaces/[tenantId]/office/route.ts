import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { officeRouteDeps } from "@/server/office-gate";
import { listOfficeConnections, unavailable } from "@/server/office-provider/connections";
import { runOffice } from "@/server/office-provider/service";
import { readBoundedJson } from "@/server/request-json";

type Context = { params: Promise<{ tenantId: string }> };
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", Vary: "Cookie" };

async function handle(request: Request, context: Context, write: boolean) {
  try {
    const deps = officeRouteDeps();
    if (!deps) throw unavailable();
    if (write) verifyOrigin(request);
    const user = await verifiedUser(request);
    const { tenantId } = await context.params;
    const db = getDb();
    const result = write
      ? await runOffice(db, user, tenantId, () => readBoundedJson(request, 65_536), deps)
      : await listOfficeConnections(db, user, tenantId, deps);
    return Response.json(result, { headers });
  } catch (error) {
    const result = errorResponse(error);
    for (const [key, value] of Object.entries(headers)) result.headers.set(key, value);
    return result;
  }
}

export function GET(request: Request, context: Context) { return handle(request, context, false); }
export function POST(request: Request, context: Context) { return handle(request, context, true); }
