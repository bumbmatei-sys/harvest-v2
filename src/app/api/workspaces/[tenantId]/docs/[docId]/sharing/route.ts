import { docsRoute } from "@/server/docs-route";
import { getSharing, setAccess } from "@/server/docs-sharing";

type Params = { tenantId: string; docId: string };
export const GET = docsRoute<Params>(({ db, user, params }) => getSharing(db, user, params.tenantId, params.docId), false);
export const PUT = docsRoute<Params>(({ db, user, params, body }) => setAccess(db, user, params.tenantId, params.docId, body), true);
