import { newsletterRoute } from "@/server/newsletter-route";
import { addPeopleToList, removePersonFromList } from "@/server/newsletter-audience";
export const runtime = "nodejs";
type P = { tenantId: string; listId: string };
export const POST = newsletterRoute<P>(({ db, user, params, body }) => addPeopleToList(db, user, params.tenantId, params.listId, body), true);
export const DELETE = newsletterRoute<P>(({ db, user, params, body }) => removePersonFromList(db, user, params.tenantId, params.listId, body), true);
