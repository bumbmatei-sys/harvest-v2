import { communityChatRoute, chatResponse, moderateChatMessage } from "@/server/community-chat";
type Params = { slug: string; messageId: string };
export const POST = communityChatRoute<Params>(async ({ db, user, params, body }) => chatResponse(await moderateChatMessage(db,user,params.slug,params.messageId,body)), { write: true });
