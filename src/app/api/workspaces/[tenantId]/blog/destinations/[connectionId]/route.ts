import { blogRoute } from "@/server/blog-route";
import { refreshExternalBlogs } from "@/server/external-blog";
import { socialRouteDeps } from "@/server/social-publish-gate";

export const runtime = "nodejs";
export const POST = blogRoute<{ tenantId: string; connectionId: string }>(({ db, user, params }) =>
  refreshExternalBlogs(db, user, params.tenantId, params.connectionId, socialRouteDeps()), true);
