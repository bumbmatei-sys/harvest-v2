import { blogRoute } from "@/server/blog-route";
import { connectExternalBlog, listExternalBlogs } from "@/server/external-blog";

export const runtime = "nodejs";
export const GET = blogRoute<{ tenantId: string }>(({ db, user, params }) => listExternalBlogs(db, user, params.tenantId), false);
export const POST = blogRoute<{ tenantId: string }>(({ db, user, params, body }) =>
  connectExternalBlog(db, user, params.tenantId, body), true);
