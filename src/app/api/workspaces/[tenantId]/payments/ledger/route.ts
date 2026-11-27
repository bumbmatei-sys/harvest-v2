import { getDb } from "@/db/client";
import { errorResponse, verifiedUser } from "@/server/http";
import { syntheticMinistryPayments } from "@/server/ministry-payments/provider";
import { ministryFinanceLedger, paymentMissing } from "@/server/ministry-payments/service";

export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    if (!syntheticMinistryPayments()) throw paymentMissing();
    const { tenantId } = await params;
    return Response.json(await ministryFinanceLedger(getDb(), await verifiedUser(request), tenantId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
