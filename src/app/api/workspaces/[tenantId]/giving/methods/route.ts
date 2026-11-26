import { givingRoute } from "@/server/ways-to-give-route";
import { createGivingMethod, listGivingMethods } from "@/server/ways-to-give";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const GET = givingRoute<Params>(({ db, user, params }) => listGivingMethods(db, user, params.tenantId), false);
export const POST = givingRoute<Params>(({ db, user, params, body }) => createGivingMethod(db, user, params.tenantId, body), true);
