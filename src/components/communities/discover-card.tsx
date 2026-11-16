/** Derived from Shadcn UI Kit item product-list7 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 7). Visual reference only; local changes: docs/ui-sources.md. */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { memberInitials } from "@/lib/community-members";

export type DiscoverCardItem = { id: string; slug: string; name: string; tagline: string | null; hostName: string; admission: string[] };

/**
 * One Discover result. The data is the sanitized Discover projection only (name, tagline, host, admission); there is no cover image or price
 * in it, so the top band is a token-coloured mark with the community's initials rather than a photograph.
 */
export function DiscoverCard({ item }: { item: DiscoverCardItem }) {
  const t = useTranslations("Discover");
  return <Card className="h-full gap-0 overflow-hidden py-0 shadow-none">
    <div aria-hidden="true" className="flex aspect-[16/7] items-center justify-center bg-muted text-3xl font-semibold tracking-tight text-muted-foreground">{memberInitials(item.name)}</div>
    <CardContent className="min-w-0 space-y-1 py-4">
      <h2 className="text-lg font-semibold break-words">{item.name}</h2>
      {item.tagline && <p className="text-sm text-muted-foreground break-words">{item.tagline}</p>}
      <p className="text-sm break-words">{t("by", { host: item.hostName })}</p>
    </CardContent>
    <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
      <div className="flex flex-wrap gap-2"><Badge variant="secondary">{t("free")}</Badge>{item.admission.includes("open") && <Badge variant="outline">{t("open")}</Badge>}</div>
      <Button asChild variant="outline" className="min-h-11"><Link href={`/communities/${item.slug}`} prefetch={false} aria-label={t("viewNamed", { name: item.name })}>{t("view")}</Link></Button>
    </CardFooter>
  </Card>;
}
