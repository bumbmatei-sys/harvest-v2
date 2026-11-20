import { newsletterRoute } from "@/server/newsletter-route";
import { cancelCampaign } from "@/server/newsletter-campaigns/campaigns";

type Params = { tenantId: string; campaignId: string };

export const POST = newsletterRoute<Params>(({ db, user, params, body }) =>
  cancelCampaign(db, user, params.tenantId, params.campaignId, body), true);
