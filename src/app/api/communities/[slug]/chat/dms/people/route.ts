import { dmPeople, dmRoute } from "@/server/community-dm";

type Params = { slug: string };
export const GET = dmRoute<Params>(async ({ db, user, params, request }) =>
  dmPeople(db, user, params.slug, new URL(request.url).searchParams.get("q")), false);
