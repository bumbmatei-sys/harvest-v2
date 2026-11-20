import { newsletterRoute } from "@/server/newsletter-route";
import { testCampaign } from "@/server/newsletter-campaigns/campaigns";

type Params = { tenantId: string; campaignId: string };

export const POST = newsletterRoute<Params>(({ db, user, params, getOwnAddress }) =>
  testCampaign(db, user, params.tenantId, params.campaignId, getOwnAddress()), true);
