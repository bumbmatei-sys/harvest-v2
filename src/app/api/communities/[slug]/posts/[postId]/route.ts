import { deletePost, savePost } from "@/server/community-forum";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
type Params = { slug: string; postId: string };
export const PATCH = communityRoute<Params>(({ db, user, params, body }) => savePost(db, user, params.slug, body, params.postId), { write: true });
export const DELETE = communityRoute<Params>(({ db, user, params }) => deletePost(db, user, params.slug, params.postId), { write: true });
