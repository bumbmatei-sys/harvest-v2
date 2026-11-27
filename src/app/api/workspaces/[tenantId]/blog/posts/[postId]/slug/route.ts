import { blogRoute } from "@/server/blog-route";
import { suggestBlogSlug } from "@/server/blog";

export const runtime = "nodejs";
type Params = { tenantId: string; postId: string };
export const GET = blogRoute<Params>(async ({ db, user, params, request }) => ({ slug: await suggestBlogSlug(db, user, params.tenantId, (new URL(request.url).searchParams.get("title") ?? "").slice(0, 400), params.postId) }), false);
