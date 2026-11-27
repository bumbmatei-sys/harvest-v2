import { blogRoute } from "@/server/blog-route";
import { refreshExternalBlogs } from "@/server/external-blog";

export const runtime = "nodejs";
export const POST = blogRoute<{ tenantId: string; connectionId: string }>(({ db, user, params }) =>
  refreshExternalBlogs(db, user, params.tenantId, params.connectionId), true);
