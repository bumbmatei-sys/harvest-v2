import { newsletterRoute } from "@/server/newsletter-route";
import { getTemplate, writeTemplate, archiveTemplate } from "@/server/newsletter-campaigns/templates";

type Params = { tenantId: string; templateId: string };

export const GET = newsletterRoute<Params>(({ db, user, params }) =>
  getTemplate(db, user, params.tenantId, params.templateId), false);
export const PATCH = newsletterRoute<Params>(({ db, user, params, body }) =>
  writeTemplate(db, user, params.tenantId, body, params.templateId), true);
export const DELETE = newsletterRoute<Params>(({ db, user, params, body }) =>
  archiveTemplate(db, user, params.tenantId, params.templateId, body), true);
