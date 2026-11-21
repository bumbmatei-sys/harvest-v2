import { createCommunityUpload } from "@/server/community-files";
import { communityRoute } from "@/server/community-route";
import { getFileStorage } from "@/server/storage";
export const runtime = "nodejs";
export const POST = communityRoute<{ slug: string }>(({ db, user, params, body }) => createCommunityUpload(db, getFileStorage(user), user, params.slug, body), { write: true });
