/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/courses/components/course-list.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { CatalogTypeArt } from "@/components/catalog/catalog-type-art";
import { publicPath, type CatalogKind } from "@/lib/catalog";

export type CatalogDiscoverItem = { id: string; slug: string; name: string; summary: string | null; hostName: string };

/**
 * One course or download in Discover. The data is the sanitized Discover projection only (name, summary, ministry); the cover is the type's code-drawn art
 * because the catalogue has no cover image yet. Free is a fact of the catalogue today (no price exists), not a claim read from the listing.
 */
export function CatalogDiscoverCard({ item, kind }: { item: CatalogDiscoverItem; kind: CatalogKind }) {
  const t = useTranslations("Discover");
  return <Card className="h-full gap-0 overflow-hidden py-0 shadow-none">
    <CatalogTypeArt kind={kind} variant="cover" className="aspect-[16/7] h-auto w-full border-b" />
    <CardContent className="min-w-0 space-y-1 py-4">
      <h2 className="text-lg font-semibold break-words">{item.name}</h2>
      {item.summary && <p className="line-clamp-3 text-sm text-muted-foreground break-words">{item.summary}</p>}
      <p className="text-sm break-words">{t("by", { host: item.hostName })}</p>
    </CardContent>
    <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
      <StatusBadge tone="success" label={t("free")} />
      <Button asChild variant="outline" className="min-h-11"><Link href={publicPath(kind, item.slug)} prefetch={false} aria-label={t("viewNamed", { name: item.name })}>{t("view")}</Link></Button>
    </CardFooter>
  </Card>;
}
