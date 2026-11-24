import { docsRoute } from "@/server/docs-route";
import { createFolder } from "@/server/docs";

export const POST = docsRoute<{ tenantId: string }>(({ db, user, params, body }) => createFolder(db, user, params.tenantId, body), true);
