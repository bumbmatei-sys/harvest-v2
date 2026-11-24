import { newsletterRoute } from "@/server/newsletter-route";
import { saveMailingAddress } from "@/server/newsletter-campaigns/sender-setup";

type Params = { tenantId: string };

export const PUT = newsletterRoute<Params>(({ db, user, params, body }) => saveMailingAddress(db, user, params.tenantId, body), true);
