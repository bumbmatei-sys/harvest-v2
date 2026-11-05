import { getDb } from "@/db/client";
import { peopleQuery } from "@/lib/crm-input";
import { createContact, listContacts } from "@/server/contacts";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    const query = peopleQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await listContacts(getDb(), user, tenantId, query), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await createContact(getDb(), user, tenantId, await request.json()), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
