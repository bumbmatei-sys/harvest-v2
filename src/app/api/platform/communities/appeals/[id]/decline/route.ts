import { communityStaffResponse, staffDeclineAppeal } from "@/server/community-takedown";
export const runtime = "nodejs";
// Keep the pause and close the ministry's open review request (Harvest staff admins only; audited).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return communityStaffResponse(request, true, (db, user) => staffDeclineAppeal(db, user, id));
}
