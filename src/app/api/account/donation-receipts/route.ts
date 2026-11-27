import { getDb } from "@/db/client";
import { errorResponse, verifiedUser } from "@/server/http";
import { syntheticMinistryPayments } from "@/server/ministry-payments/provider";
import { ownDonationReceipts, paymentMissing } from "@/server/ministry-payments/service";

export async function GET(request: Request) {
  try {
    if (!syntheticMinistryPayments()) throw paymentMissing();
    return Response.json(await ownDonationReceipts(getDb(), await verifiedUser(request)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
