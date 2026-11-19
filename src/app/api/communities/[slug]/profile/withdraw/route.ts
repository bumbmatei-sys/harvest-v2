import { memberProfileRoute, ownCommunityProfile } from "@/server/community-profile-details";

export const POST = memberProfileRoute<{ slug: string }>(({ db, user, params, body }) =>
  ownCommunityProfile(db, user, params.slug, "withdraw", body), true);
