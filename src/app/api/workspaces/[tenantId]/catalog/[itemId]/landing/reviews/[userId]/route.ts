import { catalogRoute } from "@/server/free-catalog-route";
import { setReviewHidden } from "@/server/catalog-landing";

type Params = { tenantId: string; itemId: string; userId: string };
export const PUT = catalogRoute<Params>(async (db, user, { tenantId, itemId, userId }, request) =>
  setReviewHidden(db, user, tenantId, itemId, decodeURIComponent(userId), await request.json()), "write");
