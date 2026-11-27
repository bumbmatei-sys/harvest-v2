import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { ownershipTransfer, transferInput } from "@/server/ownership-transfer";
type Context = { params: Promise<{ tenantId: string }> };

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
    const result = await ownershipTransfer(getDb(), actor, tenantId, input);
    return Response.json(result, { headers, status: input.action === "offer" ? 201 : 200 });
  } catch (error) { return errorResponse(error); }
}
