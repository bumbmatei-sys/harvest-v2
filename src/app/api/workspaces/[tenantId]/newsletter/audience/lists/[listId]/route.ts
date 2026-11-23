import { newsletterRoute } from "@/server/newsletter-route";
import { deleteAudienceList, renameAudienceList } from "@/server/newsletter-audience";
export const runtime = "nodejs";
type P = { tenantId: string; listId: string };
export const PATCH = newsletterRoute<P>(({ db, user, params, body }) => renameAudienceList(db, user, params.tenantId, params.listId, body), true);
export const DELETE = newsletterRoute<P>(({ db, user, params, body }) => deleteAudienceList(db, user, params.tenantId, params.listId, body), true);
