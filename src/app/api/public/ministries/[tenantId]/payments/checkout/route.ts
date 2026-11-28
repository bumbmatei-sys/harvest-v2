import { getDb } from "@/db/client";
import { errorResponse, verifyOrigin } from "@/server/http";
import { ministryPaymentActor } from "@/server/ministry-payments/http";
import { startMinistryCheckout } from "@/server/ministry-payments/service";

export async function POST(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const actor = await ministryPaymentActor(request);
    verifyOrigin(request);
    const { tenantId } = await params;
    return Response.json(await startMinistryCheckout(getDb(), actor, tenantId, await request.json()),
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
