import { catalogRoute } from "@/server/free-catalog-route";
import { getCatalogContent } from "@/server/free-catalog";

export const GET = catalogRoute<{ slug: string }>((db, user, { slug }) => getCatalogContent(db, user, slug), "read");
