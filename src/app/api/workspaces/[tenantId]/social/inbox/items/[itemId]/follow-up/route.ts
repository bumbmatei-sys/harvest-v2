import { inboxResponse, inboxJson, type InboxContext } from "@/server/social/inbox-http";
import { createInboxFollowUp } from "@/server/social/inbox-metadata";

export const runtime = "nodejs";

export function POST(request: Request, context: InboxContext<{ itemId: string }>) {
  return inboxResponse(request, context, true, async (db, user, { tenantId, itemId }, deps) =>
    createInboxFollowUp(db, user, tenantId, itemId, await inboxJson(request), deps), 201);
}
