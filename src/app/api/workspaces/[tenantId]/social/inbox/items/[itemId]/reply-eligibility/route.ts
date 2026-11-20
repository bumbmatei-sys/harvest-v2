import { inboxResponse, inboxJson, type InboxContext } from "@/server/social/inbox-http";
import { checkInboxReply } from "@/server/social/inbox-reply";

export const runtime = "nodejs";

export function POST(request: Request, context: InboxContext<{ itemId: string }>) {
  return inboxResponse(request, context, true, async (db, user, { tenantId, itemId }, deps) =>
    checkInboxReply(db, user, tenantId, itemId, await inboxJson(request), deps));
}
