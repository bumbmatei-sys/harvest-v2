import { givingStaffBody, givingStaffResponse, staffGivingStanding } from "@/server/platform/giving";
export const runtime = "nodejs";
// Hide or restore a ministry's public giving details at once (any active Harvest staff member; audited).
export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await context.params;
  return givingStaffResponse(request, true, async (db, user) => staffGivingStanding(db, user, tenantId, await givingStaffBody(request)));
}
