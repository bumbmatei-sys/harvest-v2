import { newsletterRoute } from "@/server/newsletter-route";
import { estimateRecipients } from "@/server/newsletter-campaigns/recipients";

type Params = { tenantId: string };

export const POST = newsletterRoute<Params>(({ db, user, params, body }) =>
  estimateRecipients(db, user, params.tenantId, body), true);
