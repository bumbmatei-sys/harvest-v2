import { docsRoute } from "@/server/docs-route";
import { removePageShare } from "@/server/docs-page-shares";

type Params = { tenantId: string; docId: string; pageId: string; userId: string };
export const DELETE = docsRoute<Params>(({ db, user, params }) => removePageShare(db, user, params.tenantId, params.docId, params.pageId, params.userId), true);
