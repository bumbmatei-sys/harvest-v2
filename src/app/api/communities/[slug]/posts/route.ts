import { savePost } from "@/server/community-forum";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
export const POST = communityRoute<{ slug: string }>(({ db, user, params, body }) => savePost(db, user, params.slug, body), { write: true });
