import { docsRoute } from "@/server/docs-route";
import { deleteTemplate, updateTemplate } from "@/server/docs-templates";

type Params = { tenantId: string; templateId: string };
export const PATCH = docsRoute<Params>(({ db, user, params, body }) => updateTemplate(db, user, params.tenantId, params.templateId, body), true);
export const DELETE = docsRoute<Params>(({ db, user, params }) => deleteTemplate(db, user, params.tenantId, params.templateId), true);
