import { readSocialAnalytics } from "@/server/social/analytics";
import { inboxResponse, type InboxContext } from "@/server/social/inbox-http";

export function GET(request: Request, context: InboxContext) {
  return inboxResponse(request, context, false, (db, user, { tenantId }, deps) => readSocialAnalytics(db, user, tenantId, new URL(request.url).searchParams, deps));
}
