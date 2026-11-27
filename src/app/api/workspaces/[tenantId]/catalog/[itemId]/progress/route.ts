import { catalogRoute } from "@/server/free-catalog-route";
import { getCatalogProgress } from "@/server/free-catalog";

type Params = { tenantId: string; itemId: string };
export const GET = catalogRoute<Params>((db, user, { tenantId, itemId }) => getCatalogProgress(db, user, tenantId, itemId), "read");
