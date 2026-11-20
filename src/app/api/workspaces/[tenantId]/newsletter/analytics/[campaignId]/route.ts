import { newsletterQuery, newsletterRoute } from "@/server/newsletter-route";
import { newsletterAnalytics } from "@/server/newsletter-campaigns/analytics";

type Params = { tenantId: string; campaignId: string };

export const GET = newsletterRoute<Params>(({ db, user, params, request }) =>
  newsletterAnalytics(db, user, params.tenantId, newsletterQuery(request), params.campaignId), false);
