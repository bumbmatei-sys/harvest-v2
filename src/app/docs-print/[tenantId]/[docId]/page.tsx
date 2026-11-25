import "@/components/docs/docs-prose.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { docsEnabled } from "@/server/docs-access";
import { printableDoc } from "@/server/docs-io";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { PrintBar } from "@/components/docs/print-bar";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { const t = await getTranslations("Docs"); return { title: t("print") }; }

// The print view of a page or a whole doc: plain, without the app around it. "PDF" opens it with the print dialog, where the browser's Save as PDF makes the file.
export default async function PrintPage({ params, searchParams }: { params: Promise<{ tenantId: string; docId: string }>; searchParams: Promise<{ scope?: string; page?: string; pdf?: string }> }) {
  if (!docsEnabled()) notFound();
  const session = await pageSession(), { tenantId, docId } = await params, q = await searchParams;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(docId).success) notFound();
  const doc = await printableDoc(getDb(), session.user.id, tenantId, docId, { scope: q.scope === "page" ? "page" : "doc", ...(q.page && uuidInput.safeParse(q.page).success ? { pageId: q.page } : {}) })
    .catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!doc) notFound();
  const t = await getTranslations("Docs");
  return <main className="mx-auto max-w-3xl p-6">
    <PrintBar auto={q.pdf === "1"} pdf={q.pdf === "1"} />
    <h1 className="mb-6 text-3xl font-bold">{doc.title || t("untitled")}</h1>
    {doc.pages.map((p) => <section key={p.id} className="mb-8 break-inside-avoid-page">{p.title && p.title !== doc.title && <h2 className="mb-3 text-2xl font-semibold">{p.title}</h2>}
      <div className="docs-prose" dangerouslySetInnerHTML={{ __html: p.html }} /></section>)}
  </main>;
}
