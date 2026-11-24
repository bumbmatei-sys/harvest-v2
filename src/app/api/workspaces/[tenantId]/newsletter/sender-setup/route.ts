import { newsletterRoute } from "@/server/newsletter-route";
import { senderSetup } from "@/server/newsletter-campaigns/sender-setup";

type Params = { tenantId: string };

export const GET = newsletterRoute<Params>(({ db, user, params }) => senderSetup(db, user, params.tenantId), false);
