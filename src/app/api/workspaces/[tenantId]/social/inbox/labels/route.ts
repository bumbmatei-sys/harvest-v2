import { inboxResponse, inboxJson, type InboxContext } from "@/server/social/inbox-http";
import { mutateInboxLabel } from "@/server/social/inbox-metadata";

export const runtime = "nodejs";

export function POST(request: Request, context: InboxContext) {
  return inboxResponse(request, context, true, async (db, user, { tenantId }, deps) =>
    mutateInboxLabel(db, user, tenantId, await inboxJson(request), deps));
}
