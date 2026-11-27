import { blogRoute } from "@/server/blog-route";
import { externalBlogOptions, queueExternalBlog } from "@/server/external-blog";

export const runtime = "nodejs";
type Params = { tenantId: string; postId: string };
export const GET = blogRoute<Params>(({ db, user, params }) => externalBlogOptions(db, user, params.tenantId, params.postId), false);
export const POST = blogRoute<Params>(({ db, user, params, body }) => queueExternalBlog(db, user, params.tenantId, params.postId, body), true);
