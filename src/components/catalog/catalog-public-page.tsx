/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/pages/products/[id]/page.tsx and apps/courses/components/instructor-section.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookOpen } from "lucide-react";
import { getDb } from "@/db/client";
import { optionalSession } from "@/server/page-session";
import { freeCatalogEnabled } from "@/server/free-catalog-mode";
import { getCatalogContent, getPublicCatalogItem } from "@/server/free-catalog";
import { AccessError } from "@/server/permissions";
import { PublicFrame } from "@/components/connect/public-frame";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { CatalogTypeArt } from "@/components/catalog/catalog-type-art";
import { DownloadList } from "@/components/catalog/download-list";
import { EnrolButton } from "@/components/catalog/enrol-button";
import { publicPath, type CatalogKind } from "@/lib/catalog";
import Link from "next/link";

const missing = (error: unknown) => { if (error instanceof AccessError && error.status === 404) return null; throw error; };

/**
 * The item's metadata, or null when it is not published, archived, or not of this kind. A listed or unlisted item resolves by its exact address; a hidden
 * one only for a signed-in member of a community whose shelf shows it (C13/C16), so it stays invisible to everyone else.
 */
export async function resolvePublicItem(slug: string, kind: CatalogKind) {
  if (!freeCatalogEnabled()) return null;
  const session = await optionalSession();
  const item = await getPublicCatalogItem(getDb(), slug, session?.user.id).catch(missing);
  if (!item) return null;
  if (item.kind !== kind) redirect(publicPath(item.kind, item.slug));
  return item;
}

/**
 * The public page of a free course or download. Signed out people see the title, the summary and a sign-in to enrol action only; the server returns no lesson,
 * file, count or learner. Signed in, the content read tells whether the person is enrolled: a course then links to its lessons and a download lists its files.
 */
export async function CatalogPublicPage({ slug, kind }: { slug: string; kind: CatalogKind }) {
  const item = await resolvePublicItem(slug, kind);
  if (!item) notFound();
  const t = await getTranslations("CatalogPublic"), session = await optionalSession();
  const content = session ? await getCatalogContent(getDb(), session.user.id, slug).catch(missing) : null;
  const here = publicPath(kind, slug);
  return <PublicFrame personal notice={false}>
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="min-w-0 space-y-6 lg:col-span-2">
        <CatalogTypeArt kind={kind} variant="cover" className="aspect-[16/7] h-auto w-full rounded-xl border" />
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge tone="info" label={t(`kinds.${kind}`)} /><StatusBadge tone="success" label={t("free")} /></div>
          <h1 className="text-[28px] font-semibold tracking-tight break-words">{item.title}</h1>
          {item.summary && <p className="max-w-prose whitespace-pre-line text-base text-muted-foreground break-words">{item.summary}</p>}
        </div>
        {kind === "download" && content && <section aria-labelledby="catalog-files" className="space-y-3"><h2 id="catalog-files" className="text-lg font-semibold">{t("files")}</h2>
          <DownloadList slug={slug} files={content.files} /></section>}
      </div>
      <aside className="min-w-0"><Card><CardContent className="space-y-4">
        <p className="text-2xl font-semibold">{t("free")}</p>
        {content
          ? kind === "course"
            ? <><p className="text-sm text-muted-foreground">{t("enrolled")}</p><Button asChild className="min-h-11 w-full"><Link href={`/courses/${slug}/learn`}><BookOpen aria-hidden="true" />{t("start")}</Link></Button></>
            : <p className="text-sm text-muted-foreground">{t("owned")}</p>
          : <EnrolButton slug={slug} kind={kind} signedIn={Boolean(session)} signInHref={`/sign-in?personal=1&next=${encodeURIComponent(here)}`} />}
      </CardContent></Card></aside>
    </div>
  </PublicFrame>;
}
