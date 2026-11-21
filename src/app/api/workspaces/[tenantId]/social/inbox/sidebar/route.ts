import { inboxResponse, type InboxContext } from "@/server/social/inbox-http";
import { inboxSidebar } from "@/server/social/inbox-read";

export const runtime = "nodejs";

export function GET(request: Request, context: InboxContext) {
  return inboxResponse(request, context, false, (db, user, { tenantId }, deps) =>
    inboxSidebar(db, user, tenantId, deps));
}
