import { dmBlockConversation, dmRoute } from "@/server/community-dm";

type Params = { slug: string; conversationId: string };
export const POST = dmRoute<Params>(async ({ db, user, params, body }) =>
  dmBlockConversation(db, user, params.slug, params.conversationId, body, false), true);
