import { docsRoute } from "@/server/docs-route";
import { setDocProtection } from "@/server/docs";

export const PUT = docsRoute<{ tenantId: string; docId: string }>(({ db, user, params, body }) => setDocProtection(db, user, params.tenantId, params.docId, body), true);
