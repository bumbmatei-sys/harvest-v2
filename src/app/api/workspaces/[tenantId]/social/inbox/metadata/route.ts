import { inboxResponse, inboxJson, type InboxContext } from "@/server/social/inbox-http";
import { searchInboxMetadata } from "@/server/social/inbox-read";

export const runtime = "nodejs";

export function POST(request: Request, context: InboxContext) {
  return inboxResponse(request, context, true, async (db, user, { tenantId }) =>
    searchInboxMetadata(db, user, tenantId, await inboxJson(request)));
}
