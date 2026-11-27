import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { syntheticMinistryPayments } from "@/server/ministry-payments/provider";
import { paymentMissing, startMinistryCheckout } from "@/server/ministry-payments/service";

export async function POST(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    if (!syntheticMinistryPayments()) throw paymentMissing();
    verifyOrigin(request);
    const { tenantId } = await params;
    return Response.json(await startMinistryCheckout(getDb(), await verifiedUser(request), tenantId, await request.json()),
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
