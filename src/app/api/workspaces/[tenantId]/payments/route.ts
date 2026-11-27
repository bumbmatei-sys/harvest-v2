import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { syntheticMinistryPayments } from "@/server/ministry-payments/provider";
import { changePaymentAccount, paymentAccount, paymentMissing } from "@/server/ministry-payments/service";

type Context = { params: Promise<{ tenantId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: Context) {
  try {
    if (!syntheticMinistryPayments()) throw paymentMissing();
    const { tenantId } = await params;
    return Response.json(await paymentAccount(getDb(), await verifiedUser(request), tenantId), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    if (!syntheticMinistryPayments()) throw paymentMissing();
    verifyOrigin(request);
    const { tenantId } = await params;
    return Response.json(await changePaymentAccount(getDb(), await verifiedUser(request), tenantId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
