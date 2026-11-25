import { newsletterRoute } from "@/server/newsletter-route";
import { removeDomain } from "@/server/newsletter-campaigns/sender-setup";

type Params = { tenantId: string; domainId: string };

export const DELETE = newsletterRoute<Params>(({ db, user, params, body }) => removeDomain(db, user, params.tenantId, params.domainId, body), true);
