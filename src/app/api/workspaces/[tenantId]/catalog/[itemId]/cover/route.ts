import { catalogRoute } from "@/server/free-catalog-route";
import { editorCatalogCover } from "@/server/catalog-assets";
import { openPrivateFile } from "@/server/storage";

export const GET = catalogRoute<{ tenantId: string; itemId: string }>((db, user, { tenantId, itemId }) =>
  editorCatalogCover(db, user, tenantId, itemId, openPrivateFile), "read");
