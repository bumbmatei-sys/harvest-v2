import { communityChatRoute, chatResponse, saveChatChannel, deleteChatChannel } from "@/server/community-chat";
type Params = { slug: string; channelId: string };
export const PUT = communityChatRoute<Params>(async ({ db, user, params, body }) => chatResponse(await saveChatChannel(db,user,params.slug,params.channelId,body)), { write: true });
export const DELETE = communityChatRoute<Params>(async ({ db, user, params }) => chatResponse(await deleteChatChannel(db,user,params.slug,params.channelId)), { write: true });
