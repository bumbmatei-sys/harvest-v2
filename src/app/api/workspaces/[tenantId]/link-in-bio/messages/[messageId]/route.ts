import { bioRoute } from "@/server/link-in-bio-route";
import { deleteBioMessage, updateBioMessage } from "@/server/link-in-bio";

export const runtime = "nodejs";
type Params = { tenantId: string; messageId: string };
export const PATCH = bioRoute<Params>(({ db, user, params, body }) => updateBioMessage(db, user, params.tenantId, params.messageId, body), true);
export const DELETE = bioRoute<Params>(({ db, user, params }) => deleteBioMessage(db, user, params.tenantId, params.messageId), true);
