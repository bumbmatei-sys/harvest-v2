import { catalogRoute } from "@/server/free-catalog-route";
import { enrolInCatalogItem } from "@/server/free-catalog";

export const POST = catalogRoute<{ slug: string }>((db, user, { slug }) => enrolInCatalogItem(db, user, slug), "write");
