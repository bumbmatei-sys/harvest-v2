import { staffAreaBody } from "@/server/platform/staff-area";
import { communityStaffResponse, staffCommunityTakedown } from "@/server/community-takedown";
export const runtime = "nodejs";
// Hide or restore one reported community, post or reply (Harvest staff admins only; audited).
export async function POST(request: Request) { return communityStaffResponse(request, true, async (db, user) => staffCommunityTakedown(db, user, await staffAreaBody(request))); }
