import { dmReport, dmRoute } from "@/server/community-dm";

type Params = { slug: string; conversationId: string };
export const POST = dmRoute<Params>(async ({ db, user, params, body }) =>
  dmReport(db, user, params.slug, body, params.conversationId), true);
