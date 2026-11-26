import { givingStaffBody, givingStaffResponse, staffResolveGivingReport } from "@/server/platform/giving";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return givingStaffResponse(request, true, async (db, user) => staffResolveGivingReport(db, user, id, await givingStaffBody(request)));
}
