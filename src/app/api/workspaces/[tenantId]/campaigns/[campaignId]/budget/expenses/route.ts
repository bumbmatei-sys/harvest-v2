import { getDb } from "@/db/client";
import { createExpense } from "@/server/campaign-budget";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// Records an expense against the campaign budget. Records only: nothing is paid.
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json(await createExpense(getDb(), user, tenantId, campaignId, await request.json()), { status: 201, headers });
  } catch (error) { return errorResponse(error); }
}
