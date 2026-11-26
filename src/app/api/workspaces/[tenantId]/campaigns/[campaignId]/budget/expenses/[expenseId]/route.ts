import { getDb } from "@/db/client";
import { deleteExpense, updateExpense } from "@/server/campaign-budget";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string; expenseId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// Edits an expense, checked against the version it was loaded at.
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId, expenseId } = await context.params;
    return Response.json(await updateExpense(getDb(), user, tenantId, campaignId, expenseId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId, expenseId } = await context.params;
    return Response.json(await deleteExpense(getDb(), user, tenantId, campaignId, expenseId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
