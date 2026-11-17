import { communityChatRoute, chatResponse, reorderChatChannels } from "@/server/community-chat";
type Params = { slug: string };
export const PUT = communityChatRoute<Params>(async ({ db, user, params, body }) => chatResponse(await reorderChatChannels(db,user,params.slug,body)), { write: true });
