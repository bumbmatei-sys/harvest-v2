import { dmAccept, dmRoute } from "@/server/community-dm";

type Params = { slug: string };
export const PUT = dmRoute<Params>(async ({ db, user, params, body }) =>
  dmAccept(db, user, params.slug, body), true);
