import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { isBrandTheme } from "@/lib/theme-registry";
import { BioPageView } from "@/components/link-in-bio/bio-view";
import { getPublicBio } from "@/server/link-in-bio";

// The public link-in-bio page. A handle that is missing, unpublished or not served here answers the same 404; no draft text ever reaches the metadata.
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const view = await getPublicBio(getDb(), handle);
  if (!view) return { title: "Not found", robots: { index: false, follow: false } };
  return { title: view.name, description: view.bio.slice(0, 160) || undefined, referrer: "no-referrer" };
}

export default async function BioPage({ params }: Props) {
  const { handle } = await params;
  const view = await getPublicBio(getDb(), handle);
  if (!view) notFound();
  // Colours come from the ministry's brand; light or dark follows the visitor's device unless the owner fixed it. Only validated values are written.
  const brand = view.brandTheme && isBrandTheme(view.brandTheme) ? view.brandTheme : "harvest";
  const script = `(function(){var d=document.documentElement,s=${JSON.stringify(view.scheme)},m=s==='auto'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):s;d.dataset.brandTheme=${JSON.stringify(brand)};d.dataset.theme=m;d.classList.toggle('dark',m==='dark')})()`;
  return <div className="min-h-dvh bg-background text-foreground"><script dangerouslySetInnerHTML={{ __html: script }} /><BioPageView view={view} handle={handle} /></div>;
}
