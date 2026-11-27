import { blogRoute } from "@/server/blog-route";
import { createBlogPost } from "@/server/blog";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const POST = blogRoute<Params>(({ db, user, params }) => createBlogPost(db, user, params.tenantId), true);
