import { givingRoute } from "@/server/ways-to-give-route";
import { deleteGivingMethod, updateGivingMethod } from "@/server/ways-to-give";

export const runtime = "nodejs";
type Params = { tenantId: string; methodId: string };
export const PATCH = givingRoute<Params>(({ db, user, params, body }) => updateGivingMethod(db, user, params.tenantId, params.methodId, body), true);
export const DELETE = givingRoute<Params>(({ db, user, params }) => deleteGivingMethod(db, user, params.tenantId, params.methodId), true);
