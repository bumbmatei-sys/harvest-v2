import { docsRoute } from "@/server/docs-route";
import { setPublicLink } from "@/server/docs-sharing";

export const POST = docsRoute<{ tenantId: string; docId: string }>(({ db, user, params, body }) => setPublicLink(db, user, params.tenantId, params.docId, body), true);
