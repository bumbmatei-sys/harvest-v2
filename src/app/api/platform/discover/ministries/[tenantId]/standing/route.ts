import { platformBody, platformResponse } from "@/server/platform/http";
import { staffStanding } from "@/server/platform/staff";
export const runtime = "nodejs";
// Admin only: suspend or restore a ministry's Discover listings.
export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await context.params;
  return platformResponse(request, true, async (db, user) => staffStanding(db, user, tenantId, await platformBody(request)));
}
