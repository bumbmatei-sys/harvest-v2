import { memberProfileRoute, readCommunityProfile } from "@/server/community-profile-details";

export const GET = memberProfileRoute<{ slug: string; userId: string }>(({ db, user, params }) =>
  readCommunityProfile(db, user, params.slug, params.userId), false);
