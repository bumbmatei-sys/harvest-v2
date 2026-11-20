import { createPostingSchedule, listPostingSchedules } from "@/server/social/posting-schedules";
import { publishResponse } from "@/server/social/publish-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };

export function GET(request: Request, context: Context) {
  return publishResponse(request, context, false, (db, user, { tenantId }, deps) =>
    listPostingSchedules(db, user, tenantId, deps));
}

export function POST(request: Request, context: Context) {
  return publishResponse(request, context, true, async (db, user, { tenantId }, deps) =>
    createPostingSchedule(db, user, tenantId, await request.json(), deps), 201);
}
