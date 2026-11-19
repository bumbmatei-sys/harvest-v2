import { catalogRoute } from "@/server/free-catalog-route";
import { getCatalogDraft, updateCatalogItem } from "@/server/free-catalog";

type Params = { tenantId: string; itemId: string };
export const GET = catalogRoute<Params>((db, user, { tenantId, itemId }) => getCatalogDraft(db, user, tenantId, itemId), "read");
export const PUT = catalogRoute<Params>(async (db, user, { tenantId, itemId }, request) =>
  updateCatalogItem(db, user, tenantId, itemId, await request.json()), "write");
