import { newsletterRoute, newsletterQuery } from "@/server/newsletter-route";
import { listAutomationRuns } from "@/server/newsletter-automations";

type Params = { tenantId: string; automationId: string };
export const GET = newsletterRoute<Params>(({ db, user, params, request }) => listAutomationRuns(db, user, params.tenantId, params.automationId, newsletterQuery(request)), false);
