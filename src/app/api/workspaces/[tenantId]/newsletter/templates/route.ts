import { newsletterQuery, newsletterRoute } from "@/server/newsletter-route";
import { listTemplates, writeTemplate } from "@/server/newsletter-campaigns/templates";

type Params = { tenantId: string };

export const GET = newsletterRoute<Params>(({ db, user, params, request }) =>
  listTemplates(db, user, params.tenantId, newsletterQuery(request)), false);
export const POST = newsletterRoute<Params>(({ db, user, params, body }) =>
  writeTemplate(db, user, params.tenantId, body), true);
