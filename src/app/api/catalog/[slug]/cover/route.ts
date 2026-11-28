import { catalogRoute } from "@/server/free-catalog-route";
import { publicCatalogCover } from "@/server/catalog-assets";
import { openPrivateFile } from "@/server/storage";

export const GET = catalogRoute<{ slug: string }>((db, user, { slug }) => publicCatalogCover(db, user, slug, openPrivateFile), "optional");
