import { bioRoute } from "@/server/link-in-bio-route";
import { transitionBioPage } from "@/server/link-in-bio";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const POST = bioRoute<Params>(({ db, user, params, body }) => transitionBioPage(db, user, params.tenantId, body), true);
