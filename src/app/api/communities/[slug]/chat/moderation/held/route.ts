import { communityChatRoute, chatModeration, chatResponse } from "@/server/community-chat";
export const GET = communityChatRoute<{ slug: string }>(async ({ db, user, params }) => chatResponse(await chatModeration(db,user,params.slug,"held")), { write: false });
