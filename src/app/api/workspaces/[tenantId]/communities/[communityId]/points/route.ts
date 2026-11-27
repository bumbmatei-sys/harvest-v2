import { communityRoute } from "@/server/community-route";
import { readCommunityPoints, writeCommunityPoints } from "@/server/community-points";

type Params = { tenantId: string; communityId: string };

export const GET = communityRoute<Params>(({ db, user, params, request }) =>
  readCommunityPoints(db, user, params.tenantId, params.communityId, new URL(request.url).searchParams.get("period") ?? undefined), { write: false });

export const POST = communityRoute<Params>(({ db, user, params, body }) =>
  writeCommunityPoints(db, user, params.tenantId, params.communityId, body), { write: true });
