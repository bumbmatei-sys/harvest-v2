/** Derived from Shadcn UI Kit item product-quickview2 (premium), registry retrieved 2026-11-25, approved 2026-11-25 (Discover screens). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { ExternalLink, Flag } from "lucide-react";
import type { DiscoverCategory } from "@/lib/discover-ui";
import { languageName, publicHref } from "@/lib/discover-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ListingMark, type ListingCardItem } from "./listing-card";

/** The public fields of one listing in a dialog, with the link to its page and the report action. Nothing here is fetched: it shows what the result already carried. */
export function QuickLook({ item, onOpenChange, onReport }: { item: ListingCardItem | null; onOpenChange: (open: boolean) => void; onReport: (item: ListingCardItem) => void }) {
  const t = useTranslations("DiscoverScreens"), format = useFormatter();
  const href = item ? publicHref(item) : null;
  return <Dialog open={item !== null} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      {item && <>
        <DialogHeader className="space-y-3 text-start">
          <ListingMark item={item} className="flex flex-wrap gap-2" />
          <DialogTitle className="text-xl break-words">{item.name}</DialogTitle>
          <DialogDescription className="break-words">{item.summary ?? t("by", { host: item.hostName })}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t("quick.host")}</dt><dd className="break-words">{item.hostName}</dd>
          {item.category && <><dt className="text-muted-foreground">{t("quick.category")}</dt><dd>{t(`categories.${item.category as DiscoverCategory}`)}</dd></>}
          {item.language && <><dt className="text-muted-foreground">{t("quick.language")}</dt><dd>{languageName(item.language)}</dd></>}
          <dt className="text-muted-foreground">{t("quick.price")}</dt><dd>{item.free ? t("free") : t("paid")}</dd>
          {item.type === "community" && item.admission && item.admission.length > 0 && <><dt className="text-muted-foreground">{t("quick.admission")}</dt>
            <dd>{item.admission.map((a) => t.has(`admission.${a}`) ? t(`admission.${a}`) : a).join(", ")}</dd></>}
          <dt className="text-muted-foreground">{t("quick.updatedLabel")}</dt><dd>{format.dateTime(new Date(item.updatedAt), { dateStyle: "medium", timeZone: "UTC" })}</dd>
        </dl>
        {!href && <p className="text-sm text-muted-foreground">{t("quick.noPage")}</p>}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" size="responsive" onClick={() => onReport(item)}><Flag aria-hidden="true" />{t("report.button")}</Button>
          {href && <Button asChild size="responsive"><Link href={href} prefetch={false}>{t("quick.openPage")}<ExternalLink aria-hidden="true" /></Link></Button>}
        </DialogFooter>
      </>}
    </DialogContent>
  </Dialog>;
}
