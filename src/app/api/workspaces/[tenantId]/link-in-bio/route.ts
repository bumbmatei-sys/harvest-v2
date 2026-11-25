import { bioRoute } from "@/server/link-in-bio-route";
import { getBioPage, saveBioDraft } from "@/server/link-in-bio";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const GET = bioRoute<Params>(({ db, user, params }) => getBioPage(db, user, params.tenantId), false);
export const PUT = bioRoute<Params>(({ db, user, params, body }) => saveBioDraft(db, user, params.tenantId, body), true);
