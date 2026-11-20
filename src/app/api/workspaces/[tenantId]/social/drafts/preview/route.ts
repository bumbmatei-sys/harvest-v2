import { previewDraft } from "@/server/social/drafts";
import { publishResponse } from "@/server/social/publish-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };

export function POST(request: Request, context: Context) {
  return publishResponse(request, context, true, async (db, user, { tenantId }) =>
    previewDraft(db, user, tenantId, await request.json()));
}
