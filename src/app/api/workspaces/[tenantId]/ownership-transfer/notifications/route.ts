import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { listOwnershipNotifications, markOwnershipNotifications } from "@/server/ownership-transfer";
type Context = { params: Promise<{ tenantId: string }> };
const headers = { "Cache-Control": "private, no-store" };
const mark = z.object({ ids: z.union([z.literal("all"), z.array(z.uuid()).max(100)]) }).strict();

export async function GET(request: Request, context: Context) {
  try {
    const actor = await verifiedUser(request);
    return Response.json(await listOwnershipNotifications(getDb(), actor, (await context.params).tenantId), { headers });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const actor = await verifiedUser(request);
    const input = mark.parse(await request.json());
    return Response.json(await markOwnershipNotifications(getDb(), actor, (await context.params).tenantId, input.ids), { headers });
  } catch (error) { return errorResponse(error); }
}
