import { getDb } from "@/db/client";
import { createDraft, listDrafts } from "@/server/campaign-wizard";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await listDrafts(getDb(), user, tenantId), { headers });
  } catch (error) { return errorResponse(error); }
}

// The Idempotency-Key makes a retried create return the same draft.
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    const { created, draft } = await createDraft(getDb(), user, tenantId, await request.json().catch(() => ({})), request.headers.get("Idempotency-Key"));
    return Response.json(draft, { status: created ? 201 : 200, headers });
  } catch (error) { return errorResponse(error); }
}
