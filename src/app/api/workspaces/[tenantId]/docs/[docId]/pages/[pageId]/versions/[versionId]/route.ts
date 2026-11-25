import { docsRoute } from "@/server/docs-route";
import { getVersion } from "@/server/docs-history";

export const GET = docsRoute<{ tenantId: string; docId: string; pageId: string; versionId: string }>(({ db, user, params }) => getVersion(db, user, params.tenantId, params.docId, params.pageId, params.versionId), false);
