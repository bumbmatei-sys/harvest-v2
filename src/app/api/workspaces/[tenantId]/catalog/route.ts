import { catalogRoute } from "@/server/free-catalog-route";
import { createCatalogItem, listCatalog } from "@/server/free-catalog";

type Params = { tenantId: string };
export const GET = catalogRoute<Params>((db, user, { tenantId }, request) =>
  listCatalog(db, user, tenantId, new URL(request.url).searchParams.get("after")), "read");
export const POST = catalogRoute<Params>(async (db, user, { tenantId }, request) =>
  createCatalogItem(db, user, tenantId, await request.json()), "write");
