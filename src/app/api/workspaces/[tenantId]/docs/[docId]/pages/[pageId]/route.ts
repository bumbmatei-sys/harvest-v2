import { docsRoute } from "@/server/docs-route";
import { deletePage, getPage, updatePage } from "@/server/docs";

type Params = { tenantId: string; docId: string; pageId: string };
export const GET = docsRoute<Params>(({ db, user, params }) => getPage(db, user, params.tenantId, params.docId, params.pageId), false);
export const PATCH = docsRoute<Params>(({ db, user, params, body }) => updatePage(db, user, params.tenantId, params.docId, params.pageId, body), true);
export const DELETE = docsRoute<Params>(({ db, user, params }) => deletePage(db, user, params.tenantId, params.docId, params.pageId), true);
