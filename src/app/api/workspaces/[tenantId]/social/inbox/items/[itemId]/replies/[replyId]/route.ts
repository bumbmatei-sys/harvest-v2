import { inboxResponse, type InboxContext } from "@/server/social/inbox-http";
import { getInboxReply } from "@/server/social/inbox-reply";

export const runtime = "nodejs";

export function GET(request: Request, context: InboxContext<{ itemId: string; replyId: string }>) {
  return inboxResponse(request, context, false, (db, user, { tenantId, itemId, replyId }) =>
    getInboxReply(db, user, tenantId, itemId, replyId));
}
