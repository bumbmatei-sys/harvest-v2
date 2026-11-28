import { blogRoute } from "@/server/blog-route";
import { externalBlogPlanner } from "@/server/external-blog";
import { plannerArticles } from "@/server/blog";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const GET = blogRoute<Params>(async ({ db, user, params, request }) => {
  const query = new URL(request.url).searchParams;
  const range = { from: query.get("from") ?? "", to: query.get("to") ?? "" };
  const articles = await plannerArticles(db, user, params.tenantId, range);
  if (query.get("includeDestinations") !== "1") return articles;
  return { articles, destinations: await externalBlogPlanner(db, user, params.tenantId, range) };
}, false);
