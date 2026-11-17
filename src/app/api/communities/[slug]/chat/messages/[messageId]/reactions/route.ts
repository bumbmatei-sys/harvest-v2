import { communityChatRoute, chatResponse, reactChatMessage } from "@/server/community-chat";
type Params = { slug: string; messageId: string };
export const POST = communityChatRoute<Params>(async ({ db, user, params, body }) => chatResponse(await reactChatMessage(db,user,params.slug,params.messageId,body)), { write: true });
