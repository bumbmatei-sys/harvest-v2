import { givingRoute } from "@/server/ways-to-give-route";
import { reorderGivingMethods } from "@/server/ways-to-give";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const PUT = givingRoute<Params>(({ db, user, params, body }) => reorderGivingMethods(db, user, params.tenantId, body), true);
