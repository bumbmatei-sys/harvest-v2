import { newsletterRoute } from "@/server/newsletter-route";
import { deleteAudienceGroup, renameAudienceGroup } from "@/server/newsletter-audience";
export const runtime = "nodejs";
type P = { tenantId: string; groupId: string };
export const PATCH = newsletterRoute<P>(({ db, user, params, body }) => renameAudienceGroup(db, user, params.tenantId, params.groupId, body), true);
export const DELETE = newsletterRoute<P>(({ db, user, params, body }) => deleteAudienceGroup(db, user, params.tenantId, params.groupId, body), true);
