import { communityChatRoute, chatState, chatModeration, chatResponse } from "@/server/community-chat";
import { reportContent } from "@/server/community-moderation";
export const POST = communityChatRoute<{ slug: string }>(async ({ db, user, params, body }) => { await chatState(db,user,params.slug); return reportContent(db,user,params.slug,body); }, { write: true });
export const GET = communityChatRoute<{ slug: string }>(async ({ db, user, params }) => { await chatState(db,user,params.slug); return chatResponse(await chatModeration(db,user,params.slug,"reports")); }, { write: false });
