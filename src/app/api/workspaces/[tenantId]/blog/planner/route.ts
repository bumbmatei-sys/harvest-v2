import { blogRoute } from "@/server/blog-route";
import { plannerArticles } from "@/server/blog";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const GET = blogRoute<Params>(({ db, user, params, request }) => {
  const query = new URL(request.url).searchParams;
  return plannerArticles(db, user, params.tenantId, { from: query.get("from") ?? "", to: query.get("to") ?? "" });
}, false);
