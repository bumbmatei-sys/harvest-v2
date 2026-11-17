import { communityChatRoute, chatResponse, deleteChatMessage } from "@/server/community-chat";
type Params = { slug: string; messageId: string };
export const POST = communityChatRoute<Params>(async ({ db, user, params }) => chatResponse(await deleteChatMessage(db,user,params.slug,params.messageId,true)), { write: true });
