import { createHash } from "node:crypto";
import { z } from "zod";
import { chargeRateLimit, rateLimitResponse } from "@/server/request-rate-limit";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { ownershipTransfer, transferInput } from "@/server/ownership-transfer";
type Context = { params: Promise<{ tenantId: string }> };

// Offer and cancel share one budget per signed-in account across its ministries.
const transferWriteLimit = 6;
const transferWriteWindowMs = 60_000;
let charges = 0;

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await verifiedUser(request);
    const { tenantId } = await context.params;
    const offerId = new URL(request.url).searchParams.get("offerId") ?? undefined;
    return Response.json({ offer: await ownershipTransfer(getDb(), actor, tenantId, { action: "status", offerId }) }, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const actor = await verifiedUser(request);
    const { tenantId } = await context.params;
    const input = transferInput.parse(await request.json());
    const db = getDb();
    if (input.action === "offer" || input.action === "cancel") {
      z.uuid().parse(tenantId);
      const key = createHash("sha256").update(actor).digest("hex");
      const charge = await chargeRateLimit(db, "ownership-transfer:", key, transferWriteLimit, transferWriteWindowMs, Date.now(), ++charges % 50 === 0);
      if (charge.limited) return rateLimitResponse(charge.retryAfter);
    }
    const result = await ownershipTransfer(db, actor, tenantId, input);
    return Response.json(result, { headers, status: input.action === "offer" ? 201 : 200 });
  } catch (error) { return errorResponse(error); }
}
