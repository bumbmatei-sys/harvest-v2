import { getDb } from "@/db/client";
import { errorResponse } from "@/server/http";
import { ministryPaymentActor } from "@/server/ministry-payments/http";
import { ownDonationReceipts } from "@/server/ministry-payments/service";

export async function GET(request: Request) {
  try {
    const actor = await ministryPaymentActor(request);
    return Response.json(await ownDonationReceipts(getDb(), actor), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
