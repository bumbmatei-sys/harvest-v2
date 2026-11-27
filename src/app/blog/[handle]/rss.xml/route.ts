import { getDb } from "@/db/client";
import { docToHtml } from "@/lib/docs-convert";
import { blogPath, rssDocument } from "@/lib/blog";
import { blogEnabled } from "@/server/blog-mode";
import { publicBlogFeed } from "@/server/blog";
import { absoluteUrl, blogImagePath } from "@/server/blog-public";
import { throttlePublicRead } from "@/server/public-read-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/** The blog's RSS 2.0 feed: the 20 newest published articles with their full text. Unknown addresses answer 404; rate limited per visitor. */
export async function GET(request: Request, context: { params: Promise<{ handle: string }> }) {
  if (!blogEnabled()) return notFound();
  const limited = await throttlePublicRead(request, "blog");
  if (limited) return limited;
  const { handle } = await context.params;
  try {
    const feed = await publicBlogFeed(getDb(), handle);
    const link = feed ? absoluteUrl(blogPath(feed.handle)) : undefined;
    if (!feed || !link) return notFound();
    const items = feed.items.map((item) => ({ title: item.title, link: absoluteUrl(blogPath(feed.handle, item.slug))!, description: item.excerpt, publishedAt: item.publishedAt,
      html: docToHtml(item.body, { image: (id) => absoluteUrl(blogImagePath(feed.handle, id)) ?? null }) }));
    const xml = rssDocument({ title: feed.title, description: feed.intro, link, self: absoluteUrl(`${blogPath(feed.handle)}/rss.xml`)!, items, updatedAt: feed.items[0]?.updatedAt });
    return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch { return notFound(); }
}
