import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { deleteView, updateView } from "@/server/crm-views";
const objectType = (request: Request) => z.enum(["person", "company"]).parse(new URL(request.url).searchParams.get("object"));
type Context = { params: Promise<{ tenantId: string; viewId: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, viewId } = await context.params;
    return Response.json(await updateView(getDb(), user, tenantId, objectType(request), viewId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, viewId } = await context.params;
    return Response.json(await deleteView(getDb(), user, tenantId, objectType(request), viewId));
  } catch (error) { return errorResponse(error); }
}
