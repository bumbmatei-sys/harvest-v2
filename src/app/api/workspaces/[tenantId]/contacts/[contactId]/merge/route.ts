import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { mergeContacts, previewMerge } from "@/server/crm-merge";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; contactId: string }> };
/** GET ?sourceId= previews merging that person into this one; nothing changes. */
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, contactId } = await context.params;
    return Response.json(await previewMerge(getDb(), user, tenantId, contactId, new URL(request.url).searchParams.get("sourceId") ?? ""), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, contactId } = await context.params;
    return Response.json(await mergeContacts(getDb(), user, tenantId, contactId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
