import { catalogRoute } from "@/server/free-catalog-route";
import { courseResources } from "@/server/catalog-assets";

export const GET = catalogRoute<{ slug: string }>((db, user, { slug }) => courseResources(db, user, slug), "read");
