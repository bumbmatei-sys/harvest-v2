import { catalogRoute } from "@/server/free-catalog-route";
import { setCatalogState } from "@/server/free-catalog";

type Params = { tenantId: string; itemId: string };
export const PUT = catalogRoute<Params>(async (db, user, { tenantId, itemId }, request) =>
  setCatalogState(db, user, tenantId, itemId, await request.json()), "write");
