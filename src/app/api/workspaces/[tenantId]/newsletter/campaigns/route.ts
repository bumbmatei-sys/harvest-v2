import { newsletterQuery, newsletterRoute } from "@/server/newsletter-route";
import { listCampaigns, writeCampaign } from "@/server/newsletter-campaigns/campaigns";

type Params = { tenantId: string };

export const GET = newsletterRoute<Params>(({ db, user, params, request }) =>
  listCampaigns(db, user, params.tenantId, newsletterQuery(request)), false);
export const POST = newsletterRoute<Params>(({ db, user, params, body }) =>
  writeCampaign(db, user, params.tenantId, body), true);
