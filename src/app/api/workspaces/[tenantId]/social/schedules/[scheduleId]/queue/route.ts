import { searchParamsRecord } from "@/server/http";
import { listScheduleQueue } from "@/server/social/planner";
import { publishResponse } from "@/server/social/publish-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; scheduleId: string }> };

export function GET(request: Request, context: Context) {
  return publishResponse(request, context, false, (db, user, { tenantId, scheduleId }, deps) =>
    listScheduleQueue(db, user, tenantId, scheduleId, searchParamsRecord(request.url), deps));
}
