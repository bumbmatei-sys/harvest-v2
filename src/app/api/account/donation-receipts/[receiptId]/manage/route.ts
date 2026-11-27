import { getDb } from "@/db/client";
import { errorResponse, verifyOrigin } from "@/server/http";
import { ministryPaymentActor } from "@/server/ministry-payments/http";
import { donationManagementLink } from "@/server/ministry-payments/service";

export async function POST(request: Request, { params }: { params: Promise<{ receiptId: string }> }) {
  try {
    const actor = await ministryPaymentActor(request);
    verifyOrigin(request);
    const { receiptId } = await params;
    return Response.json(await donationManagementLink(getDb(), actor, receiptId, await request.json()),
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
