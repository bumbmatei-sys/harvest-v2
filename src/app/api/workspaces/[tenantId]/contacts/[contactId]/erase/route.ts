import { getDb } from "@/db/client";
import { erasureInput } from "@/lib/contact-input";
import { eraseContact } from "@/server/contacts";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; contactId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, contactId } = await context.params;
    erasureInput.parse(await request.json());
    return Response.json(await eraseContact(getDb(), user, tenantId, contactId));
  } catch (error) { return errorResponse(error); }
}
