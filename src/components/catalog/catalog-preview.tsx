/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/pages/products/[id]/page.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { CatalogTypeArt } from "@/components/catalog/catalog-type-art";
import { publicPath, type CatalogKind } from "@/lib/catalog";

/**
 * How the item looks on its public page: the type's art as the cover, the title, the summary and a free badge. Sample state only (no learner, no
 * enrolment, no request): the button is inert. The address shows where the page will live.
 */
export function CatalogPreview({ kind, title, summary, slug, host }: { kind: CatalogKind; title: string; summary: string; slug: string; host: string }) {
  const t = useTranslations("Catalog");
  return <Card className="gap-0 overflow-hidden py-0 shadow-none">
    <CatalogTypeArt kind={kind} variant="cover" className="aspect-[16/7] h-auto w-full border-b" />
    <CardContent className="min-w-0 space-y-2 py-4">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge tone="info" label={t(`kinds.${kind}`)} /><StatusBadge tone="success" label={t("free")} /></div>
      <p className="text-lg font-semibold break-words">{title.trim() || t("untitled")}</p>
      {summary.trim() && <p className="line-clamp-4 text-sm text-muted-foreground break-words">{summary}</p>}
      <p className="text-sm break-words">{t("by", { host })}</p>
    </CardContent>
    <CardFooter className="flex flex-col items-stretch gap-2 border-t py-3">
      <Button className="min-h-11 w-full" disabled>{t(kind === "course" ? "previewEnrol" : "previewGet")}</Button>
      {slug && <p className="truncate text-xs text-muted-foreground" dir="ltr">{publicPath(kind, slug)}</p>}
    </CardFooter>
  </Card>;
}
