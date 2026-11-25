import { docsQuery, docsRoute } from "@/server/docs-route";
import { addLink, listLinks } from "@/server/docs-links";

type Params = { tenantId: string; docId: string };
export const GET = docsRoute<Params>(({ db, user, params, request }) => listLinks(db, user, params.tenantId, params.docId, docsQuery(request)), false);
export const POST = docsRoute<Params>(({ db, user, params, body }) => addLink(db, user, params.tenantId, params.docId, body), true);
