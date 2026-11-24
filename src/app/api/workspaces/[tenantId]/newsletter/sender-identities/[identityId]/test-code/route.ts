import { newsletterRoute } from "@/server/newsletter-route";
import { syntheticMailboxCode } from "@/server/newsletter-campaigns/synthetic-mailbox";

type Params = { tenantId: string; identityId: string };

export const GET = newsletterRoute<Params>(({ db, user, params }) => syntheticMailboxCode(db, user, params.tenantId, params.identityId), false);
