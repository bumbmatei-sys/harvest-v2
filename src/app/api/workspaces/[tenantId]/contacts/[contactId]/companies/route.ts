import { getDb } from "@/db/client";
import { linkCompany } from "@/server/contacts";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; contactId: string }> };
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, contactId } = await context.params;
    return Response.json(await linkCompany(getDb(), user, tenantId, contactId, await request.json()), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
