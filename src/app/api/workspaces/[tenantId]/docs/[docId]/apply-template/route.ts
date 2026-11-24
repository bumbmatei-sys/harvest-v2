import { docsRoute } from "@/server/docs-route";
import { applyTemplate } from "@/server/docs-templates";

export const POST = docsRoute<{ tenantId: string; docId: string }>(({ db, user, params, body }) => applyTemplate(db, user, params.tenantId, params.docId, body), true);
