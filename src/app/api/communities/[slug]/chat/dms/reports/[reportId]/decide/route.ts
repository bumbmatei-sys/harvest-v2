import { dmDecide, dmRoute } from "@/server/community-dm";

type Params = { slug: string; reportId: string };
export const POST = dmRoute<Params>(async ({ db, user, params, body }) =>
  dmDecide(db, user, params.slug, params.reportId, body), true);
