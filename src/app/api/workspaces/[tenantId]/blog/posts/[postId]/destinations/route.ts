import { blogRoute } from "@/server/blog-route";
import { externalBlogOptions, queueExternalBlog } from "@/server/external-blog";
import { socialRouteDeps } from "@/server/social-publish-gate";

// The same non-production gate as the Social Publish routes: the in-memory fake outside production, the hard-off defaults in production.
export const runtime = "nodejs";
type Params = { tenantId: string; postId: string };
export const GET = blogRoute<Params>(({ db, user, params }) => externalBlogOptions(db, user, params.tenantId, params.postId, socialRouteDeps()), false);
export const POST = blogRoute<Params>(({ db, user, params, body }) => queueExternalBlog(db, user, params.tenantId, params.postId, body, socialRouteDeps()), true);
