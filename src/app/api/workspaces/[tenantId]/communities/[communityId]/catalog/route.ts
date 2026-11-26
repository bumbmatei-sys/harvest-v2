import { catalogRoute } from "@/server/free-catalog-route";
import { arrangeCommunityShelf } from "@/server/free-catalog";

type Params = { tenantId: string; communityId: string };
// C13/C16: order one shelf of the community and choose its featured item.
export const PUT = catalogRoute<Params>(async (db, user, { tenantId, communityId }, request) =>
  arrangeCommunityShelf(db, user, tenantId, communityId, await request.json()), "write");
