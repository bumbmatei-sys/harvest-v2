import { createCategory, listCategories } from "@/server/communities";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
type Params = { tenantId: string; communityId: string };
export const GET = communityRoute<Params>(({ db, user, params }) => listCategories(db, user, params.tenantId, params.communityId), { write: false });
export const POST = communityRoute<Params>(({ db, user, params, body }) => createCategory(db, user, params.tenantId, params.communityId, body), { write: true });
