import { catalogRoute } from "@/server/free-catalog-route";
import { setCommunityProductLink } from "@/server/free-catalog";

type Params = { tenantId: string; communityId: string; itemId: string };
export const PUT = catalogRoute<Params>(async (db, user, { tenantId, communityId, itemId }, request) =>
  setCommunityProductLink(db, user, tenantId, communityId, itemId, await request.json()), "write");
export const DELETE = catalogRoute<Params>((db, user, { tenantId, communityId, itemId }) =>
  setCommunityProductLink(db, user, tenantId, communityId, itemId, undefined, true), "write");
