import { getDb } from "@/db/client";
import { errorResponse, verifyOrigin } from "@/server/http";
import { ministryPaymentActor } from "@/server/ministry-payments/http";
import { changePaymentAccount, paymentAccount } from "@/server/ministry-payments/service";

type Context = { params: Promise<{ tenantId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await ministryPaymentActor(request);
    const { tenantId } = await params;
    return Response.json(await paymentAccount(getDb(), actor, tenantId), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await ministryPaymentActor(request);
    verifyOrigin(request);
    const { tenantId } = await params;
    return Response.json(await changePaymentAccount(getDb(), actor, tenantId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
