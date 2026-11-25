import { docsRoute } from "@/server/docs-route";
import { setShare } from "@/server/docs-sharing";

export const POST = docsRoute<{ tenantId: string; docId: string }>(({ db, user, params, body }) => setShare(db, user, params.tenantId, params.docId, body), true);
