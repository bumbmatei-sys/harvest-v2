import { newsletterQuery, newsletterRoute } from "@/server/newsletter-route";
import { listIdentities, createIdentity } from "@/server/newsletter-campaigns/identities";
import { syntheticMailboxSink } from "@/server/newsletter-campaigns/synthetic-mailbox";

type Params = { tenantId: string };

export const GET = newsletterRoute<Params>(({ db, user, params, request }) =>
  listIdentities(db, user, params.tenantId, newsletterQuery(request)), false);
export const POST = newsletterRoute<Params>(({ db, user, params, body }) =>
  createIdentity(db, user, params.tenantId, body, syntheticMailboxSink(params.tenantId)), true);
