import { docsRoute } from "@/server/docs-route";
import { removeShare } from "@/server/docs-sharing";

export const DELETE = docsRoute<{ tenantId: string; docId: string; userId: string }>(({ db, user, params }) => removeShare(db, user, params.tenantId, params.docId, params.userId), true);
