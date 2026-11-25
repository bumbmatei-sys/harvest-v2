import { newsletterRoute } from "@/server/newsletter-route";
import { getRunLog } from "@/server/newsletter-automations";

type Params = { tenantId: string; automationId: string; runId: string };
export const GET = newsletterRoute<Params>(({ db, user, params }) => getRunLog(db, user, params.tenantId, params.automationId, params.runId), false);
