import { docsRoute } from "@/server/docs-route";
import { detachFile } from "@/server/docs-io";

export const DELETE = docsRoute<{ tenantId: string; docId: string; fileId: string }>(({ db, user, params }) => detachFile(db, user, params.tenantId, params.docId, params.fileId), true);
