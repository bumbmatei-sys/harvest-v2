import "@/components/docs/docs-prose.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { docToHtml } from "@/lib/docs-convert";
import { readPublicDoc } from "@/server/docs-sharing";
import { AccessError } from "@/server/permissions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

// A publicly shared doc, read-only, no session. It exists only where the non-production gate allows public links; anywhere else the address answers 404.
export default async function SharedDocPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ page?: string }> }) {
  const { token } = await params, { page } = await searchParams;
  const doc = await readPublicDoc(getDb(), token).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!doc) notFound();
  const t = await getTranslations("Docs");
  const current = doc.pages.find((p) => p.id === page) ?? doc.pages.filter((p) => p.parentId === null)[0] ?? doc.pages[0];
  return <main className="mx-auto max-w-3xl p-6">
    <h1 className="mb-2 text-3xl font-bold">{current?.title || doc.title || t("untitled")}</h1>
    {doc.pages.length > 1 && <nav aria-label={t("pages")} className="mb-6 flex flex-wrap gap-3 border-b pb-3 text-sm">{doc.pages.map((p) => <a key={p.id} href={`?page=${p.id}`} className={p.id === current?.id ? "font-semibold" : "text-muted-foreground underline-offset-2 hover:underline"}>{p.title || t("untitled")}</a>)}</nav>}
    {current && <div className="docs-prose" dangerouslySetInnerHTML={{ __html: docToHtml(current.content) }} />}
  </main>;
}
