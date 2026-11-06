import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { commitImport } from "@/server/crm-imports";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; importId: string }> };
/** Commits the next chunk of rows; call until `remaining` is 0. Safe to repeat. */
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, importId } = await context.params;
    return Response.json(await commitImport(getDb(), user, tenantId, importId));
  } catch (error) { return errorResponse(error); }
}
