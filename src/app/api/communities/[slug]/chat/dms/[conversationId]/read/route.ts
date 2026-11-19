import { dmPrefs, dmRoute } from "@/server/community-dm";

type Params = { slug: string; conversationId: string };
export const PUT = dmRoute<Params>(async ({ db, user, params, body }) =>
  dmPrefs(db, user, params.slug, params.conversationId, "read", body), true);
