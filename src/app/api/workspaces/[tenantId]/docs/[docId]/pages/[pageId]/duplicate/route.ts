import { docsRoute } from "@/server/docs-route";
import { duplicatePage } from "@/server/docs";

export const POST = docsRoute<{ tenantId: string; docId: string; pageId: string }>(({ db, user, params }) => duplicatePage(db, user, params.tenantId, params.docId, params.pageId), true);
