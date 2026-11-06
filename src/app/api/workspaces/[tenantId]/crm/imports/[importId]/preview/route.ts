import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { previewImport } from "@/server/crm-imports";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; importId: string }> };
/** Dry run: classifies every row against live data; nothing outside the import changes. */
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, importId } = await context.params;
    return Response.json(await previewImport(getDb(), user, tenantId, importId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
