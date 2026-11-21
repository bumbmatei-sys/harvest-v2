import { readSocialAnalytics } from "@/server/social/analytics";
import { inboxResponse, type InboxContext } from "@/server/social/inbox-http";
import { socialRouteDeps } from "@/server/social-publish-gate";

// The non-production gate supplies the test dependencies (the fake provider); in production the hard-off defaults answer 404.
export function GET(request: Request, context: InboxContext) {
  const deps = socialRouteDeps();
  return inboxResponse(request, context, false, (db,user,{tenantId})=>readSocialAnalytics(db,user,tenantId,new URL(request.url).searchParams,deps), 200, deps);
}
