import { communityChatRoute, chatResponse, muteChatChannel } from "@/server/community-chat";
type Params = { slug: string; channelId: string };
export const PUT = communityChatRoute<Params>(async ({ db, user, params, body }) => chatResponse(await muteChatChannel(db,user,params.slug,params.channelId,body)), { write: true });
