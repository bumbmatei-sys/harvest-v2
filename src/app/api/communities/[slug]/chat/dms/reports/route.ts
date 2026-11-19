import { dmReport, dmReports, dmRoute } from "@/server/community-dm";

type Params = { slug: string };
export const GET = dmRoute<Params>(async ({ db, user, params }) =>
  dmReports(db, user, params.slug), false);
export const POST = dmRoute<Params>(async ({ db, user, params, body }) =>
  dmReport(db, user, params.slug, body), true);
