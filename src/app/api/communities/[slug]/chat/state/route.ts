import { communityChatRoute, chatResponse, chatState } from "@/server/community-chat";
type Params = { slug: string };
export const GET = communityChatRoute<Params>(async ({ db, user, params, request }) => chatResponse(await chatState(db,user,params.slug,request.headers.get("if-none-match"))), { write: false });
