import { getDb } from "@/db/client";
import { getCrmReport } from "@/server/crm-reports";
import { errorResponse, verifiedUser } from "@/server/http";

export const runtime = "nodejs";

type Context = { params: Promise<{ tenantId: string }> };

/** Read-only CRM report aggregates: ministry totals for owners and admins, own work for members, nothing for viewers. */
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await getCrmReport(getDb(), user, tenantId, new URL(request.url).searchParams.get("period") ?? "last30"), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
