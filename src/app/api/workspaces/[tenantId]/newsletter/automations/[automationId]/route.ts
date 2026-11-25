import { newsletterRoute } from "@/server/newsletter-route";
import { getAutomation, updateAutomation } from "@/server/newsletter-automations";

type Params = { tenantId: string; automationId: string };
export const GET = newsletterRoute<Params>(({ db, user, params }) => getAutomation(db, user, params.tenantId, params.automationId), false);
export const PATCH = newsletterRoute<Params>(({ db, user, params, body }) => updateAutomation(db, user, params.tenantId, params.automationId, body), true);
