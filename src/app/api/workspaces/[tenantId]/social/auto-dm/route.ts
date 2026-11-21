import { createAutoDmRule, listAutoDmRules } from "@/server/social/auto-dm";
import { inboxJson, inboxResponse, type InboxContext } from "@/server/social/inbox-http";

export function GET(request: Request, context: InboxContext) {
  return inboxResponse(request, context, false, (db, user, { tenantId }, deps) => listAutoDmRules(db, user, tenantId, deps));
}
export function POST(request: Request, context: InboxContext) {
  return inboxResponse(request, context, true, async (db, user, { tenantId }, deps) => createAutoDmRule(db, user, tenantId, await inboxJson(request), deps), 201);
}
