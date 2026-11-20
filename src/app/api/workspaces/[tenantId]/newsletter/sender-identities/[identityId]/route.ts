import { newsletterRoute } from "@/server/newsletter-route";
import { updateIdentity } from "@/server/newsletter-campaigns/identities";

type Params = { tenantId: string; identityId: string };

export const PATCH = newsletterRoute<Params>(({ db, user, params, body }) =>
  updateIdentity(db, user, params.tenantId, params.identityId, body), true);
