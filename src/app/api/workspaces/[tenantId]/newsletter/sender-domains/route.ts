import { newsletterRoute } from "@/server/newsletter-route";
import { addDomain } from "@/server/newsletter-campaigns/sender-setup";

type Params = { tenantId: string };

export const POST = newsletterRoute<Params>(({ db, user, params, body }) => addDomain(db, user, params.tenantId, body), true);
