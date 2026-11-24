import { newsletterRoute } from "@/server/newsletter-route";
import { deleteIdentity, updateIdentity } from "@/server/newsletter-campaigns/identities";
import { syntheticMailboxSink } from "@/server/newsletter-campaigns/synthetic-mailbox";

type Params = { tenantId: string; identityId: string };

export const PATCH = newsletterRoute<Params>(({ db, user, params, body }) =>
  updateIdentity(db, user, params.tenantId, params.identityId, body, syntheticMailboxSink(params.tenantId)), true);

export const DELETE = newsletterRoute<Params>(({ db, user, params, body }) => deleteIdentity(db, user, params.tenantId, params.identityId, body), true);
