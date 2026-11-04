import { getDb } from "@/db/client";
import { updateWorkspaceTheme } from "@/server/workspaces";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await updateWorkspaceTheme(getDb(), user, tenantId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
