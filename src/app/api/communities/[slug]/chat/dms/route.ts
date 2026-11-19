import { dmList, dmRoute, dmStart } from "@/server/community-dm";

type Params = { slug: string };
export const GET = dmRoute<Params>(async ({ db, user, params, request }) =>
  dmList(db, user, params.slug, new URL(request.url).searchParams), false);
export const POST = dmRoute<Params>(async ({ db, user, params, body }) =>
  dmStart(db, user, params.slug, body), true);
