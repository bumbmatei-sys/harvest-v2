import { docsRoute } from "@/server/docs-route";
import { getPageShares, setPageShare } from "@/server/docs-page-shares";

type Params = { tenantId: string; docId: string; pageId: string };
export const GET = docsRoute<Params>(({ db, user, params }) => getPageShares(db, user, params.tenantId, params.docId, params.pageId), false);
export const POST = docsRoute<Params>(({ db, user, params, body }) => setPageShare(db, user, params.tenantId, params.docId, params.pageId, body), true);
