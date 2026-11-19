import { communityChatRoute, chatResponse, chatManageSettings, saveChatSettings } from "@/server/community-chat";
type Params = { slug: string };
export const GET = communityChatRoute<Params>(async ({ db, user, params }) => Response.json({ channels: await chatManageSettings(db, user, params.slug) }, { headers: { "Cache-Control": "private, no-store" } }), { write: false });
export const PUT = communityChatRoute<Params>(async ({ db, user, params, body }) => chatResponse(await saveChatSettings(db,user,params.slug,body)), { write: true });
