import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { PublicFrame } from "@/components/connect/public-frame";
import { BlogIndex } from "@/components/blog/blog-public";
import { blogEnabled } from "@/server/blog-mode";
import { publicBlogIndex } from "@/server/blog";
import { absoluteUrl, blogPageCharge } from "@/server/blog-public";
import { blogPath } from "@/lib/blog";

// The public blog. Read per request through the published-only definer, so unpublishing takes effect at once. Unknown addresses answer 404.
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ handle: string }>; searchParams: Promise<{ page?: string }> };
const pageOf = (value?: string) => { const n = Number(value ?? "1"); return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : NaN; };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  if (!blogEnabled() || (await blogPageCharge()).limited) return { robots: { index: false, follow: false } };
  const { handle } = await params, page = pageOf((await searchParams).page);
  const view = Number.isNaN(page) ? null : await publicBlogIndex(getDb(), handle, page);
  if (!view) return { title: "Not found", robots: { index: false, follow: false } };
  const path = page === 1 ? blogPath(view.handle) : `${blogPath(view.handle)}?page=${page}`, description = view.intro ?? undefined;
  return { title: view.title, description, alternates: { canonical: absoluteUrl(path), types: { "application/rss+xml": [{ url: absoluteUrl(`${blogPath(view.handle)}/rss.xml`) ?? `${blogPath(view.handle)}/rss.xml`, title: view.title }] } },
    openGraph: { type: "website", title: view.title, description, url: absoluteUrl(path) }, twitter: { card: "summary", title: view.title, description } };
}

export default async function BlogIndexPage({ params, searchParams }: Props) {
  if (!blogEnabled()) notFound();
  if ((await blogPageCharge()).limited) return <PublicFrame personal notice={false}><p role="status" className="text-sm text-muted-foreground">{(await getTranslations("Blog.public"))("busy")}</p></PublicFrame>;
  const { handle } = await params, page = pageOf((await searchParams).page);
  const view = Number.isNaN(page) ? null : await publicBlogIndex(getDb(), handle, page);
  if (!view) notFound();
  return <PublicFrame personal notice={false}><BlogIndex view={view} /></PublicFrame>;
}
