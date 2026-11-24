import { docsRoute } from "@/server/docs-route";
import { removeLink } from "@/server/docs-links";

export const DELETE = docsRoute<{ tenantId: string; docId: string; linkId: string }>(({ db, user, params }) => removeLink(db, user, params.tenantId, params.docId, params.linkId), true);
