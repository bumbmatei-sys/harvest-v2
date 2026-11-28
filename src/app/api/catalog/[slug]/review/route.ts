import { catalogRoute } from "@/server/free-catalog-route";
import { saveReview } from "@/server/catalog-landing";

export const PUT = catalogRoute<{ slug: string }>(async (db, user, { slug }, request) => saveReview(db, user, slug, await request.json()), "write");
