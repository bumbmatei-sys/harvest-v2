import { readDraft, changeDraft } from "@/server/social/drafts";
import { publishResponse } from "@/server/social/publish-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; draftId: string }> };

export function GET(request: Request, context: Context) {
  return publishResponse(request, context, false, (db, user, { tenantId, draftId }) =>
    readDraft(db, user, tenantId, draftId));
}

export function PATCH(request: Request, context: Context) {
  return publishResponse(request, context, true, async (db, user, { tenantId, draftId }) =>
    changeDraft(db, user, tenantId, draftId, await request.json()));
}
