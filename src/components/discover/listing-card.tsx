/** Derived from Shadcn UI Kit item product-card1 (premium), registry retrieved 2026-11-25, approved 2026-11-25 (Discover screens). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Flag } from "lucide-react";
import type { DiscoverCard } from "@/server/discover/public";
import { categoryIcons, publicHref, typeIcons } from "@/lib/discover-ui";
import type { DiscoverCategory } from "@/lib/discover-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";

export type ListingCardItem = Pick<DiscoverCard, "type" | "id" | "slug" | "name" | "summary" | "hostName" | "category" | "language" | "audience" | "free" | "pricing" | "admission" | "updatedAt">;
const admissionKeys = ["open", "apply", "invite", "entitlement"] as const;

/** The type badge and the category mark of a listing, shared by the card and the quick look so both name the type the same way. */
export function ListingMark({ item, className }: { item: Pick<ListingCardItem, "type" | "category">; className?: string }) {
  const t = useTranslations("DiscoverScreens");
  const Type = typeIcons[item.type], Category = item.category ? categoryIcons[item.category as DiscoverCategory] : undefined;
  return <div className={className}>
    <Badge variant="secondary" className="gap-1.5"><Type className="size-3.5" aria-hidden="true" />{t(`typeNames.${item.type}`)}</Badge>
    {item.category && Category && <Badge variant="outline" className="gap-1.5"><Category className="size-3.5" aria-hidden="true" />{t(`categories.${item.category as DiscoverCategory}`)}</Badge>}
  </div>;
}

/**
 * One Discover result. Only the sanitized public fields the server returns are shown (type, name, summary, host, category, price, joining); there is no cover image, rating or
 * member count in the data, so the top band is a token-coloured category mark rather than a photograph. Communities link to their public page; courses and products open the quick look.
 */
export function ListingCard({ item, onQuickLook, onReport }: { item: ListingCardItem; onQuickLook: () => void; onReport: () => void }) {
  const t = useTranslations("DiscoverScreens");
  const href = publicHref(item), Mark = item.category ? categoryIcons[item.category as DiscoverCategory] : typeIcons[item.type];
  return <Card data-slot="listing-card" data-type={item.type} className="h-full gap-0 overflow-hidden py-0 shadow-none">
    <div aria-hidden="true" className="flex aspect-[16/7] items-center justify-center bg-muted text-muted-foreground"><Mark className="size-10" strokeWidth={1.5} /></div>
    <CardContent className="min-w-0 flex-1 space-y-3 py-4">
      <ListingMark item={item} className="flex flex-wrap gap-2" />
      <div className="min-w-0 space-y-1">
        <h2 className="text-lg font-semibold break-words">{item.name}</h2>
        {item.summary && <p className="line-clamp-3 text-sm text-muted-foreground break-words">{item.summary}</p>}
        <p className="text-sm break-words">{t("by", { host: item.hostName })}</p>
      </div>
    </CardContent>
    <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
      <div className="flex flex-wrap gap-2">
        {item.free && <Badge variant="secondary">{t("free")}</Badge>}
        {item.type === "community" && item.admission?.filter((a): a is typeof admissionKeys[number] => (admissionKeys as readonly string[]).includes(a)).slice(0, 1).map((a) => <Badge key={a} variant="outline">{t(`admission.${a}`)}</Badge>)}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon" className="size-11" onClick={onReport} aria-label={t("report.buttonNamed", { name: item.name })}><Flag aria-hidden="true" /></Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={onQuickLook} aria-label={t("quickLookNamed", { name: item.name })}>{t("quickLook")}</Button>
        {href && <Button asChild className="min-h-11"><Link href={href} prefetch={false} aria-label={t("viewNamed", { name: item.name })}>{t("view")}</Link></Button>}
      </div>
    </CardFooter>
  </Card>;
}
