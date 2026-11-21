import { autoDmActivity, changeAutoDmRule } from "@/server/social/auto-dm";
import { inboxJson, inboxResponse, type InboxContext } from "@/server/social/inbox-http";

type Context = InboxContext<{ ruleId: string }>;
export function GET(request: Request, context: Context) {
  return inboxResponse(request, context, false, (db, user, { tenantId, ruleId }, deps) =>
    autoDmActivity(db, user, tenantId, ruleId, new URL(request.url).searchParams.get("before"), deps));
}
export function PATCH(request: Request, context: Context) {
  return inboxResponse(request, context, true, async (db, user, { tenantId, ruleId }, deps) =>
    changeAutoDmRule(db, user, tenantId, ruleId, await inboxJson(request), deps));
}
