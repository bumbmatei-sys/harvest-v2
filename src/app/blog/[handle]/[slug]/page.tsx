import "@/components/docs/docs-prose.css";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db/client";
import { PublicFrame } from "@/components/connect/public-frame";
import { RichTextView } from "@/components/rich-text/rich-text-view";
import { BlogCards } from "@/components/blog/blog-public";
import { blogEnabled } from "@/server/blog-mode";
import { publicBlogPost } from "@/server/blog";
import { absoluteUrl, blogImagePath, blogPageCharge } from "@/server/blog-public";
import { blogPath } from "@/lib/blog";

// One published article. Draft, scheduled, unpublished and unknown articles all answer the same 404; no draft text reaches the metadata.
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ handle: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!blogEnabled() || (await blogPageCharge()).limited) return { robots: { index: false, follow: false } };
  const { handle, slug } = await params, view = await publicBlogPost(getDb(), handle, slug);
  if (!view) return { title: "Not found", robots: { index: false, follow: false } };
  const title = view.seoTitle ?? view.title, description = view.seoDescription ?? (view.excerpt || undefined), url = absoluteUrl(blogPath(view.blog.handle, view.slug));
  const picture = view.shareId ?? view.coverId, image = picture ? absoluteUrl(blogImagePath(view.blog.handle, picture)) : undefined;
  return { title, description, alternates: { canonical: url, types: { "application/rss+xml": [{ url: absoluteUrl(`${blogPath(view.blog.handle)}/rss.xml`) ?? `${blogPath(view.blog.handle)}/rss.xml`, title: view.blog.title }] } },
    openGraph: { type: "article", title, description, url, siteName: view.blog.title, publishedTime: view.publishedAt, modifiedTime: view.updatedAt, ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, ...(image ? { images: [image] } : {}) } };
}

export default async function BlogArticlePage({ params }: Props) {
  if (!blogEnabled()) notFound();
  const t = await getTranslations("Blog.public");
  if ((await blogPageCharge()).limited) return <PublicFrame personal notice={false}><p role="status" className="text-sm text-muted-foreground">{t("busy")}</p></PublicFrame>;
  const { handle, slug } = await params, view = await publicBlogPost(getDb(), handle, slug);
  if (!view) notFound();
  const format = await getFormatter(), blog = view.blog;
  return <PublicFrame personal notice={false}>
    <article className="mx-auto max-w-3xl space-y-8" data-blog-article>
      <Link href={blogPath(blog.handle)} className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />{t("backToBlog", { blog: blog.title })}</Link>
      <header className="space-y-4">
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">{view.title}</h1>
        {view.excerpt && <p className="text-pretty text-lg text-muted-foreground">{view.excerpt}</p>}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><time dateTime={view.publishedAt}>{t("published", { date: format.dateTime(new Date(view.publishedAt), { dateStyle: "long" }) })}</time>
          {view.readingMinutes > 0 && <span>{t("minutes", { count: view.readingMinutes })}</span>}</p>
      </header>
      {/* eslint-disable-next-line @next/next/no-img-element -- a short signed redirect from the server, not optimisable */}
      {view.coverId && <img src={blogImagePath(blog.handle, view.coverId)} alt="" className="aspect-[16/9] w-full rounded-xl border object-cover" />}
      <RichTextView format="doc" doc={view.body} className="text-base" imageSrc={(id) => blogImagePath(blog.handle, id)} />
    </article>
    {view.more.length > 0 && <section aria-labelledby="blog-more" className="mx-auto mt-16 max-w-6xl space-y-6 border-t pt-10" data-blog-more>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="blog-more" className="text-2xl font-semibold tracking-tight">{t("moreArticles")}</h2>
        <Link href={blogPath(blog.handle)} className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline">{t("allArticles")}</Link></div>
      <BlogCards handle={blog.handle} cards={view.more} headingLevel={3} />
    </section>}
  </PublicFrame>;
}
