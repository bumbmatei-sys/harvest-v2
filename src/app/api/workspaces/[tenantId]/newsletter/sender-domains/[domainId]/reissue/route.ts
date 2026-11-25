import { newsletterRoute } from "@/server/newsletter-route";
import { reissueDomain } from "@/server/newsletter-campaigns/sender-setup";

type Params = { tenantId: string; domainId: string };

export const POST = newsletterRoute<Params>(({ db, user, params, body }) => reissueDomain(db, user, params.tenantId, params.domainId, body), true);
