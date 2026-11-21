import { inboxResponse, inboxJson, type InboxContext } from "@/server/social/inbox-http";
import { listInbox } from "@/server/social/inbox-read";

export const runtime = "nodejs";

export function POST(request: Request, context: InboxContext) {
  return inboxResponse(request, context, true, async (db, user, { tenantId }, deps) =>
    listInbox(db, user, tenantId, await inboxJson(request, 525000), deps));
}
