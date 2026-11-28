import { blogRoute } from "@/server/blog-route";
import { connectExternalBlog, listExternalBlogs } from "@/server/external-blog";
import { socialRouteDeps } from "@/server/social-publish-gate";

// The same non-production gate as the Social Publish routes: the in-memory fake outside production, the hard-off defaults in production.
export const runtime = "nodejs";
export const GET = blogRoute<{ tenantId: string }>(({ db, user, params }) => listExternalBlogs(db, user, params.tenantId, socialRouteDeps()), false);
export const POST = blogRoute<{ tenantId: string }>(({ db, user, params, body }) =>
  connectExternalBlog(db, user, params.tenantId, body, socialRouteDeps()), true);
