import { docsRoute } from "@/server/docs-route";
import { movePage } from "@/server/docs";

export const POST = docsRoute<{ tenantId: string; docId: string; pageId: string }>(({ db, user, params, body }) => movePage(db, user, params.tenantId, params.docId, params.pageId, body), true);
