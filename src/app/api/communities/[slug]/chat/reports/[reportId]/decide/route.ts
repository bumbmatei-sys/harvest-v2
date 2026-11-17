import { communityChatRoute, chatState } from "@/server/community-chat";
import { decideReport } from "@/server/community-moderation";
export const POST = communityChatRoute<{ slug: string; reportId: string }>(async ({ db, user, params, body }) => { await chatState(db,user,params.slug); return decideReport(db,user,params.slug,params.reportId,body); }, { write: true });
