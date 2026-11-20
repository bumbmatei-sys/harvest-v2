import { inboxResponse, inboxJson, type InboxContext } from "@/server/social/inbox-http";
import { readInboxConversation } from "@/server/social/inbox-read";

export const runtime = "nodejs";

export function GET(request: Request, context: InboxContext<{ itemId: string }>) {
  return inboxResponse(request, context, false, (db, user, { tenantId, itemId }, deps) =>
    readInboxConversation(db, user, tenantId, itemId, {}, deps));
}

export function POST(request: Request, context: InboxContext<{ itemId: string }>) {
  return inboxResponse(request, context, true, async (db, user, { tenantId, itemId }, deps) =>
    readInboxConversation(db, user, tenantId, itemId, await inboxJson(request, 525000), deps));
}
