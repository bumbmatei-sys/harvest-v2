import { communityChatRoute, chatResponse, chatState, saveChatChannel } from "@/server/community-chat";
type Params = { slug: string };
export const GET = communityChatRoute<Params>(async ({ db, user, params }) => chatResponse(await chatState(db,user,params.slug)), { write: false });
export const POST = communityChatRoute<Params>(async ({ db, user, params, body }) => chatResponse(await saveChatChannel(db,user,params.slug,null,body)), { write: true });
