import { catalogRoute } from "@/server/free-catalog-route";
import { getPublicCatalogItem } from "@/server/free-catalog";

export const GET = catalogRoute<{ slug: string }>((db, _user, { slug }) => getPublicCatalogItem(db, slug), "public");
