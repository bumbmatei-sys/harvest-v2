import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { syntheticMinistryPayments } from "@/server/ministry-payments/provider";
import { donationManagementLink, paymentMissing } from "@/server/ministry-payments/service";

export async function POST(request: Request, { params }: { params: Promise<{ receiptId: string }> }) {
  try {
    if (!syntheticMinistryPayments()) throw paymentMissing();
    verifyOrigin(request);
    const { receiptId } = await params;
    return Response.json(await donationManagementLink(getDb(), await verifiedUser(request), receiptId, await request.json()),
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
