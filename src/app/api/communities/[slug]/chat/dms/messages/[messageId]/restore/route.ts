import { dmChangeMessage, dmRoute } from "@/server/community-dm";

type Params = { slug: string; messageId: string };
export const POST = dmRoute<Params>(async ({ db, user, params }) =>
  dmChangeMessage(db, user, params.slug, params.messageId, "restore"), true);
