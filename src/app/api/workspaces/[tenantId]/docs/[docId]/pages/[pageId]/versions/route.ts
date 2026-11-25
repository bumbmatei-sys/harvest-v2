import { docsRoute } from "@/server/docs-route";
import { listVersions } from "@/server/docs-history";

export const GET = docsRoute<{ tenantId: string; docId: string; pageId: string }>(({ db, user, params }) => listVersions(db, user, params.tenantId, params.docId, params.pageId), false);
