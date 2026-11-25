import { bioRoute } from "@/server/link-in-bio-route";
import { bioChoices } from "@/server/link-in-bio";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const GET = bioRoute<Params>(({ db, user, params }) => bioChoices(db, user, params.tenantId), false);
