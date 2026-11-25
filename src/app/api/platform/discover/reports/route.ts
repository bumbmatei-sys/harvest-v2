import { platformResponse } from "@/server/platform/http";
import { staffReports } from "@/server/platform/staff";
export const runtime = "nodejs";
export function GET(request: Request) { return platformResponse(request, false, (db, user) => staffReports(db, user)); }
