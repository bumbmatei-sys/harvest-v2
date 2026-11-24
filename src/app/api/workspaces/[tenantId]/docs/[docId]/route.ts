import { docsRoute } from "@/server/docs-route";
import { getDoc, updateDoc } from "@/server/docs";

type Params = { tenantId: string; docId: string };
export const GET = docsRoute<Params>(({ db, user, params }) => getDoc(db, user, params.tenantId, params.docId), false);
export const PATCH = docsRoute<Params>(({ db, user, params, body }) => updateDoc(db, user, params.tenantId, params.docId, body), true);
