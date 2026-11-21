import { inboxResponse, inboxJson, type InboxContext } from "@/server/social/inbox-http";
import { listInboxNotes } from "@/server/social/inbox-read";

import { mutateInboxNote } from "@/server/social/inbox-metadata";

export const runtime = "nodejs";

export function GET(request: Request, context: InboxContext<{ itemId: string }>) {
  return inboxResponse(request, context, false, (db, user, { tenantId, itemId }, deps) =>
    listInboxNotes(db, user, tenantId, itemId, deps));
}

export function POST(request: Request, context: InboxContext<{ itemId: string }>) {
  return inboxResponse(request, context, true, async (db, user, { tenantId, itemId }, deps) =>
    mutateInboxNote(db, user, tenantId, itemId, await inboxJson(request), deps));
}
