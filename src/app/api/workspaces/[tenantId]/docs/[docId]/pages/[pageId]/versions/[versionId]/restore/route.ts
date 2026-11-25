import { docsRoute } from "@/server/docs-route";
import { restoreVersion } from "@/server/docs-history";

export const POST = docsRoute<{ tenantId: string; docId: string; pageId: string; versionId: string }>(({ db, user, params, body }) => restoreVersion(db, user, params.tenantId, params.docId, params.pageId, params.versionId, body), true);
