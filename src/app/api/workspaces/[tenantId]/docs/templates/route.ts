import { docsQuery, docsRoute } from "@/server/docs-route";
import { listTemplates, saveTemplate } from "@/server/docs-templates";

type Params = { tenantId: string };
export const GET = docsRoute<Params>(({ db, user, params, request }) => listTemplates(db, user, params.tenantId, docsQuery(request)), false);
export const POST = docsRoute<Params>(({ db, user, params, body }) => saveTemplate(db, user, params.tenantId, body), true);
