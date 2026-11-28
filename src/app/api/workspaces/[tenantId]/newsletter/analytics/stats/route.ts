import { newsletterQuery, newsletterRoute } from "@/server/newsletter-route";
import { newsletterStatistics } from "@/server/newsletter-campaigns/statistics";

export const GET = newsletterRoute<{ tenantId: string }>(({ db, user, params, request }) =>
  newsletterStatistics(db, user, params.tenantId, newsletterQuery(request)), false);
