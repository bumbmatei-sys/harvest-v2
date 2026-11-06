import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { recordAssociation } from "@/server/crm-associations";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
/**
 * Links a Zernio, form or touchpoint event to a person. 201 when stored; 200 with
 * `stored: false` and a reason when the person was not found or consent does not allow it.
 */
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    const result = await recordAssociation(getDb(), user, tenantId, await request.json());
    return Response.json(result, { status: result.stored && !result.duplicate ? 201 : 200 });
  } catch (error) { return errorResponse(error); }
}
