import { blogRoute } from "@/server/blog-route";
import { changeBlogPostState } from "@/server/blog";

export const runtime = "nodejs";
type Params = { tenantId: string; postId: string };
export const POST = blogRoute<Params>(({ db, user, params, body }) => changeBlogPostState(db, user, params.tenantId, params.postId, body), true);
