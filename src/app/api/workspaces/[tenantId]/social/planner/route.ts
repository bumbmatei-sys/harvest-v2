import { searchParamsRecord } from "@/server/http";
import { listPlanner } from "@/server/social/planner";
import { publishResponse } from "@/server/social/publish-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };

export function GET(request: Request, context: Context) {
  return publishResponse(request, context, false, (db, user, { tenantId }, deps) =>
    listPlanner(db, user, tenantId, searchParamsRecord(request.url), deps));
}
