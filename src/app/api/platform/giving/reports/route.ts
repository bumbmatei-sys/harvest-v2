import { givingStaffResponse, staffGivingReports } from "@/server/platform/giving";
export const runtime = "nodejs";
export function GET(request: Request) { return givingStaffResponse(request, false, (db, user) => staffGivingReports(db, user, new URL(request.url).searchParams.get("status") ?? undefined)); }
