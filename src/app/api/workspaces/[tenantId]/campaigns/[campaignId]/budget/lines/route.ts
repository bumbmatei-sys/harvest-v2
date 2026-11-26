import { getDb } from "@/db/client";
import { createBudgetLine } from "@/server/campaign-budget";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// Adds a category with its planned amount to the campaign budget. Records only: no money moves.
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json(await createBudgetLine(getDb(), user, tenantId, campaignId, await request.json()), { status: 201, headers });
  } catch (error) { return errorResponse(error); }
}
