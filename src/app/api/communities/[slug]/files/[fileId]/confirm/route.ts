import { confirmCommunityUpload } from "@/server/community-files";
import { communityRoute } from "@/server/community-route";
import { getStorage } from "@/server/storage";
export const runtime = "nodejs";
export const POST = communityRoute<{ slug: string; fileId: string }>(({ db, user, params }) => confirmCommunityUpload(db, getStorage(), user, params.slug, params.fileId), { write: true });
