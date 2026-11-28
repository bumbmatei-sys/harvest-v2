import { catalogRoute } from "@/server/free-catalog-route";
import { publicCatalogDirectory } from "@/server/catalog-assets";

export const GET = catalogRoute<{ tenantId: string }>((db, _user, { tenantId }, request) =>
  publicCatalogDirectory(db, tenantId, Object.fromEntries(new URL(request.url).searchParams)), "public");
