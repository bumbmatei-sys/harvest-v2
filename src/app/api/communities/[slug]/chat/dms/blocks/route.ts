import { dmBlock, dmRoute } from "@/server/community-dm";

type Params = { slug: string };
export const POST = dmRoute<Params>(async ({ db, user, params, body }) =>
  dmBlock(db, user, params.slug, body, false), true);
export const DELETE = dmRoute<Params>(async ({ db, user, params, body }) =>
  dmBlock(db, user, params.slug, body, true), true);
