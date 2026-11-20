import { searchParamsRecord } from "@/server/http";
import { saveDraft } from "@/server/social/drafts";
import { listUnscheduledDrafts } from "@/server/social/planner";
import { publishResponse } from "@/server/social/publish-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };

export function GET(request: Request, context: Context) {
  return publishResponse(request, context, false, (db, user, { tenantId }, deps) =>
    listUnscheduledDrafts(db, user, tenantId, searchParamsRecord(request.url), deps));
}

export function POST(request: Request, context: Context) {
  return publishResponse(request, context, true, async (db, user, { tenantId }, deps) =>
    saveDraft(db, user, tenantId, await request.json(), deps), 201);
}
