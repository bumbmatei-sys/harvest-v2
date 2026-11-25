import { newsletterRoute } from "@/server/newsletter-route";
import { createAutomation, listAutomations } from "@/server/newsletter-automations";

type Params = { tenantId: string };
export const GET = newsletterRoute<Params>(({ db, user, params }) => listAutomations(db, user, params.tenantId), false);
export const POST = newsletterRoute<Params>(({ db, user, params, body }) => createAutomation(db, user, params.tenantId, body), true);
