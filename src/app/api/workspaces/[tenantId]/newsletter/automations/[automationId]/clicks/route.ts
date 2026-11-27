import { newsletterRoute } from "@/server/newsletter-route";
import { automationClicks } from "@/server/newsletter-automations";

type Params = { tenantId: string; automationId: string };
export const GET = newsletterRoute<Params>(({ db, user, params }) => automationClicks(db, user, params.tenantId, params.automationId), false);
