import { communityChatRoute, chatResponse, saveChatSettings } from "@/server/community-chat";
export const PUT = communityChatRoute<{ slug: string }>(async ({ db, user, params, body }) => chatResponse(await saveChatSettings(db,user,params.slug,body)), { write: true });
