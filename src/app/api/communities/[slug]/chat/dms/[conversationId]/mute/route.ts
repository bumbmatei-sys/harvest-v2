import { dmPrefs, dmRoute } from "@/server/community-dm";

type Params = { slug: string; conversationId: string };
export const POST = dmRoute<Params>(async ({ db, user, params, body }) =>
  dmPrefs(db, user, params.slug, params.conversationId, "mute", body), true);
