import { bioRoute } from "@/server/link-in-bio-route";
import { listBioMessages } from "@/server/link-in-bio";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const GET = bioRoute<Params>(({ db, user, params }) => listBioMessages(db, user, params.tenantId), false);
