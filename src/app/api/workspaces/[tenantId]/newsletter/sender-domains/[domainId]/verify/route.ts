import { newsletterRoute } from "@/server/newsletter-route";
import { verifyDomain } from "@/server/newsletter-campaigns/sender-setup";

type Params = { tenantId: string; domainId: string };

export const POST = newsletterRoute<Params>(({ db, user, params }) => verifyDomain(db, user, params.tenantId, params.domainId), true);
