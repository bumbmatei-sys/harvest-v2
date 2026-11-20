import { readSocialPostAnalytics } from "@/server/social/analytics";
import { inboxResponse, type InboxContext } from "@/server/social/inbox-http";

export function GET(request: Request, context: InboxContext<{postId:string}>) {
  return inboxResponse(request, context, false, (db,user,{tenantId,postId})=>
    readSocialPostAnalytics(db,user,tenantId,postId,new URL(request.url).searchParams));
}
