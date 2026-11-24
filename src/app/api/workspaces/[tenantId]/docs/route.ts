import { docsQuery, docsRoute } from "@/server/docs-route";
import { createDoc, listDocs } from "@/server/docs";

type Params = { tenantId: string };
export const GET = docsRoute<Params>(({ db, user, params, request }) => listDocs(db, user, params.tenantId, docsQuery(request)), false);
export const POST = docsRoute<Params>(({ db, user, params, body }) => createDoc(db, user, params.tenantId, body), true);
