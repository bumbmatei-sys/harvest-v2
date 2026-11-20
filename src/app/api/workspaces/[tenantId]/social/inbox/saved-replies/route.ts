import { inboxResponse, inboxJson, type InboxContext } from "@/server/social/inbox-http";
import { listSavedInboxReplies, mutateSavedInboxReply } from "@/server/social/inbox-metadata";

export const runtime = "nodejs";

export function GET(request: Request, context: InboxContext) {
  return inboxResponse(request, context, false, (db, user, { tenantId }) =>
    listSavedInboxReplies(db, user, tenantId));
}

export function POST(request: Request, context: InboxContext) {
  return inboxResponse(request, context, true, async (db, user, { tenantId }) =>
    mutateSavedInboxReply(db, user, tenantId, await inboxJson(request)));
}
