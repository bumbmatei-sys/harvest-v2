import { inboxResponse, inboxJson, type InboxContext } from "@/server/social/inbox-http";
import { getInboxHours, saveInboxHours } from "@/server/social/inbox-metadata";

export const runtime = "nodejs";

export function GET(request: Request, context: InboxContext<{ connectionId: string }>) {
  return inboxResponse(request, context, false, (db, user, { tenantId, connectionId }, deps) =>
    getInboxHours(db, user, tenantId, connectionId, deps));
}

export function PATCH(request: Request, context: InboxContext<{ connectionId: string }>) {
  return inboxResponse(request, context, true, async (db, user, { tenantId, connectionId }, deps) =>
    saveInboxHours(db, user, tenantId, connectionId, await inboxJson(request), deps));
}
