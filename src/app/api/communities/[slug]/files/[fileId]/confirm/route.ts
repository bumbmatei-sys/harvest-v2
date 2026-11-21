import { confirmCommunityUpload } from "@/server/community-files";
import { communityRoute } from "@/server/community-route";
import { getFileStorage } from "@/server/storage";
export const runtime = "nodejs";
export const POST = communityRoute<{ slug: string; fileId: string }>(({ db, user, params }) => confirmCommunityUpload(db, getFileStorage(user), user, params.slug, params.fileId), { write: true });
