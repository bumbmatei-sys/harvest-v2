import { newsletterRoute } from "@/server/newsletter-route";
import { getCampaign, writeCampaign } from "@/server/newsletter-campaigns/campaigns";

type Params = { tenantId: string; campaignId: string };

export const GET = newsletterRoute<Params>(({ db, user, params }) =>
  getCampaign(db, user, params.tenantId, params.campaignId), false);
export const PATCH = newsletterRoute<Params>(({ db, user, params, body }) =>
  writeCampaign(db, user, params.tenantId, body, params.campaignId), true);
