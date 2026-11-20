import { newsletterRoute } from "@/server/newsletter-route";
import { dispatchCampaign } from "@/server/newsletter-campaigns/campaigns";

type Params = { tenantId: string; campaignId: string };

export const POST = newsletterRoute<Params>(({ db, user, params, body }) =>
  dispatchCampaign(db, user, params.tenantId, params.campaignId, body, "schedule"), true);
