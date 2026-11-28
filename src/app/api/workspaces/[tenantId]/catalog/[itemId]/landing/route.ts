import { catalogRoute } from "@/server/free-catalog-route";
import { getLanding, saveLanding } from "@/server/catalog-landing";

type Params = { tenantId: string; itemId: string };
export const GET = catalogRoute<Params>((db, user, { tenantId, itemId }) => getLanding(db, user, tenantId, itemId), "read");
export const PUT = catalogRoute<Params>(async (db, user, { tenantId, itemId }, request) => saveLanding(db, user, tenantId, itemId, await request.json()), "write");
