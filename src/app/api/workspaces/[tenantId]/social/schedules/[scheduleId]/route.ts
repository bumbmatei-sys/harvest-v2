import { changePostingSchedule } from "@/server/social/posting-schedules";
import { publishResponse } from "@/server/social/publish-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; scheduleId: string }> };

export function PATCH(request: Request, context: Context) {
  return publishResponse(request, context, true, async (db, user, { tenantId, scheduleId }, deps) =>
    changePostingSchedule(db, user, tenantId, scheduleId, await request.json(), false, deps));
}

export function DELETE(request: Request, context: Context) {
  return publishResponse(request, context, true, async (db, user, { tenantId, scheduleId }, deps) =>
    changePostingSchedule(db, user, tenantId, scheduleId, await request.json(), true, deps));
}
