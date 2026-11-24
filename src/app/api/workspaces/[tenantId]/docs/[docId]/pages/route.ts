import { docsRoute } from "@/server/docs-route";
import { createPage } from "@/server/docs";

export const POST = docsRoute<{ tenantId: string; docId: string }>(({ db, user, params, body }) => createPage(db, user, params.tenantId, params.docId, body), true);
