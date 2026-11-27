import { staffAreaBody } from "@/server/platform/staff-area";
import { communityStaffResponse, staffResolveCommunityReport } from "@/server/community-takedown";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return communityStaffResponse(request, true, async (db, user) => staffResolveCommunityReport(db, user, id, await staffAreaBody(request)));
}
