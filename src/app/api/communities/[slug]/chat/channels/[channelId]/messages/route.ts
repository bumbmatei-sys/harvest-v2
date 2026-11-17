import { communityChatRoute, chatResponse, chatMessages, sendChatMessage } from "@/server/community-chat";
type Params = { slug: string; channelId: string };
export const GET = communityChatRoute<Params>(async ({ db, user, params, request }) => chatResponse(await chatMessages(db,user,params.slug,params.channelId,Object.fromEntries(new URL(request.url).searchParams),request.headers.get("if-none-match"))), { write: false });
export const POST = communityChatRoute<Params>(async ({ db, user, params, body }) => chatResponse(await sendChatMessage(db,user,params.slug,params.channelId,body)), { write: true });
