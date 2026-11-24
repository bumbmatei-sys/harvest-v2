import { docsRoute } from "@/server/docs-route";
import { setDocFavorite } from "@/server/docs";

type Params = { tenantId: string; docId: string };
export const PUT = docsRoute<Params>(({ db, user, params }) => setDocFavorite(db, user, params.tenantId, params.docId, true), true);
export const DELETE = docsRoute<Params>(({ db, user, params }) => setDocFavorite(db, user, params.tenantId, params.docId, false), true);
