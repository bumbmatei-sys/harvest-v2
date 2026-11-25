import { docsQuery, docsRoute } from "@/server/docs-route";
import { searchTargets } from "@/server/docs-links";

export const GET = docsRoute<{ tenantId: string; docId: string }>(({ db, user, params, request }) => searchTargets(db, user, params.tenantId, params.docId, docsQuery(request)), false);
