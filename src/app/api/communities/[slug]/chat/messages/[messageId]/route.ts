import { communityChatRoute, chatResponse, editChatMessage, deleteChatMessage } from "@/server/community-chat";
type Params = { slug: string; messageId: string };
export const PATCH = communityChatRoute<Params>(async ({ db, user, params, body }) => chatResponse(await editChatMessage(db,user,params.slug,params.messageId,body)), { write: true });
export const DELETE = communityChatRoute<Params>(async ({ db, user, params }) => chatResponse(await deleteChatMessage(db,user,params.slug,params.messageId)), { write: true });
