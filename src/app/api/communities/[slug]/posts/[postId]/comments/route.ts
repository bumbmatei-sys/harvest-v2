import { saveComment } from "@/server/community-forum";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
export const POST = communityRoute<{ slug: string; postId: string }>(({ db, user, params, body }) => saveComment(db, user, params.slug, params.postId, body), { write: true });
