import { communityStaffResponse, staffCommunityReports } from "@/server/community-takedown";
export const runtime = "nodejs";
export function GET(request: Request) { return communityStaffResponse(request, false, (db, user) => staffCommunityReports(db, user, new URL(request.url).searchParams.get("status") ?? undefined)); }
