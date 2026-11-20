import { previewAutoDmRule } from "@/server/social/auto-dm";
import { inboxJson, inboxResponse, type InboxContext } from "@/server/social/inbox-http";

export function POST(request: Request, context: InboxContext) {
  return inboxResponse(request, context, true, async (db, user, { tenantId }) =>
    previewAutoDmRule(db, user, tenantId, await inboxJson(request)));
}
