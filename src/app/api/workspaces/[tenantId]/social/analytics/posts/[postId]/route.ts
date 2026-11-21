import { readSocialPostAnalytics } from "@/server/social/analytics";
import { inboxResponse, type InboxContext } from "@/server/social/inbox-http";
import { socialRouteDeps } from "@/server/social-publish-gate";

export function GET(request: Request, context: InboxContext<{postId:string}>) {
  const deps = socialRouteDeps();
  return inboxResponse(request, context, false, (db,user,{tenantId,postId})=>
    readSocialPostAnalytics(db,user,tenantId,postId,new URL(request.url).searchParams,deps), 200, deps);
}
