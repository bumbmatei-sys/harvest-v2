import { docsRoute } from "@/server/docs-route";
import { deleteFolder, updateFolder } from "@/server/docs";

type Params = { tenantId: string; folderId: string };
export const PATCH = docsRoute<Params>(({ db, user, params, body }) => updateFolder(db, user, params.tenantId, params.folderId, body), true);
export const DELETE = docsRoute<Params>(({ db, user, params, body }) => deleteFolder(db, user, params.tenantId, params.folderId, body), true);
