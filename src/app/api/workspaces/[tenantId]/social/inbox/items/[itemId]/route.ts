import { inboxResponse, inboxJson, type InboxContext } from "@/server/social/inbox-http";
import { mutateInboxItem } from "@/server/social/inbox-metadata";

export const runtime = "nodejs";

export function PATCH(request: Request, context: InboxContext<{ itemId: string }>) {
  return inboxResponse(request, context, true, async (db, user, { tenantId, itemId }) =>
    mutateInboxItem(db, user, tenantId, itemId, await inboxJson(request)));
}
