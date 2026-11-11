import { deleteCategory, moveCategory, updateCategory } from "@/server/communities";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
type Params = { tenantId: string; communityId: string; categoryId: string };
// PATCH either renames/edits ({ name, emoji, hostsOnly }) or reorders ({ direction }).
export const PATCH = communityRoute<Params>(({ db, user, params, body }) => body && typeof body === "object" && "direction" in body
  ? moveCategory(db, user, params.tenantId, params.communityId, params.categoryId, body)
  : updateCategory(db, user, params.tenantId, params.communityId, params.categoryId, body), { write: true });
export const DELETE = communityRoute<Params>(({ db, user, params }) => deleteCategory(db, user, params.tenantId, params.communityId, params.categoryId), { write: true });
