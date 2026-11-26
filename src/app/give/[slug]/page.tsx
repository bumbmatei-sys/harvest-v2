import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { PublicFrame } from "@/components/connect/public-frame";
import { GivePageView } from "@/components/fundraising/give-page-view";
import { givePageEnabled } from "@/server/give-page-mode";
import { publicGiveMethods, publicGivePage } from "@/server/give-page";

// The public fundraising page. Resolved per request through the published-only definer, so closing the fundraiser or a staff takedown takes effect at once.
// Unknown, draft, closed, archived and hidden pages all answer the same 404; no draft text reaches the metadata. Private, no-store (src/proxy.ts).
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };

const absolute = (path: string) => { try { return new URL(path, process.env.BETTER_AUTH_URL).href; } catch { return undefined; } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const view = givePageEnabled() ? await publicGivePage(getDb(), slug) : null;
  if (!view) return { title: "Not found", robots: { index: false, follow: false } };
  const description = view.description?.replace(/\s+/g, " ").slice(0, 160) || undefined, image = view.hasCover ? absolute(`/give/${view.slug}/cover`) : undefined;
  return { title: view.title, description, referrer: "no-referrer", robots: { index: false, follow: false },
    openGraph: { type: "website", title: view.title, description, url: absolute(`/give/${view.slug}`), ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: image ? "summary_large_image" : "summary", title: view.title, description, ...(image ? { images: [image] } : {}) } };
}

export default async function GivePage({ params }: Props) {
  if (!givePageEnabled()) notFound();
  const { slug } = await params, db = getDb();
  const view = await publicGivePage(db, slug);
  if (!view) notFound();
  const methods = await publicGiveMethods(db, slug);
  return <PublicFrame personal notice={false}>
    <div className="mx-auto max-w-5xl"><GivePageView view={view} coverUrl={view.hasCover ? `/give/${view.slug}/cover` : null} methods={methods} reportUrl={`/give/${view.slug}/report`} /></div>
  </PublicFrame>;
}
