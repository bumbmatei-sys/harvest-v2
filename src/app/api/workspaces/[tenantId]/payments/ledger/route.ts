import { getDb } from "@/db/client";
import { errorResponse } from "@/server/http";
import { ministryPaymentActor } from "@/server/ministry-payments/http";
import { ministryFinanceLedger } from "@/server/ministry-payments/service";

export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const actor = await ministryPaymentActor(request);
    const { tenantId } = await params;
    return Response.json(await ministryFinanceLedger(getDb(), actor, tenantId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
