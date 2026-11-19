import { memberProfileRoute, ownCommunityProfile } from "@/server/community-profile-details";

type Params = { slug: string };
export const GET = memberProfileRoute<Params>(({ db, user, params }) =>
  ownCommunityProfile(db, user, params.slug, "get"), false);
export const PUT = memberProfileRoute<Params>(({ db, user, params, body }) =>
  ownCommunityProfile(db, user, params.slug, "save", body), true);
export const DELETE = memberProfileRoute<Params>(({ db, user, params, body }) =>
  ownCommunityProfile(db, user, params.slug, "erase", body), true);
