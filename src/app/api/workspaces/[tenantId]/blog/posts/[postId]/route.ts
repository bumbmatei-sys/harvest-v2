import { blogRoute } from "@/server/blog-route";
import { deleteBlogPost, getBlogPost, saveBlogPost } from "@/server/blog";

export const runtime = "nodejs";
type Params = { tenantId: string; postId: string };
export const GET = blogRoute<Params>(({ db, user, params }) => getBlogPost(db, user, params.tenantId, params.postId), false);
export const PUT = blogRoute<Params>(({ db, user, params, body }) => saveBlogPost(db, user, params.tenantId, params.postId, body), true);
export const DELETE = blogRoute<Params>(({ db, user, params, request }) => deleteBlogPost(db, user, params.tenantId, params.postId, Number(new URL(request.url).searchParams.get("version"))), true);
