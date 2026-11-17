import { communityChatRoute, chatResponse, setChatChannelMembers } from "@/server/community-chat";
type Params = { slug: string; channelId: string };
export const PUT = communityChatRoute<Params>(async ({ db, user, params, body }) => chatResponse(await setChatChannelMembers(db,user,params.slug,params.channelId,body)), { write: true });
