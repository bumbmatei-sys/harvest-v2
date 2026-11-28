import { catalogRoute } from "@/server/free-catalog-route";
import { setCatalogPublication } from "@/server/free-catalog";

type Params = { tenantId: string; itemId: string };
export const PUT = catalogRoute<Params>(async (db, user, { tenantId, itemId }, request) =>
  setCatalogPublication(db, user, tenantId, itemId, await request.json()), "write");
