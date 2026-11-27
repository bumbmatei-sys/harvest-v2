"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ListingCard, type ListingCardItem } from "@/components/discover/listing-card";
import { publicPath } from "@/lib/catalog";
import type { BioCatalogCard } from "@/lib/link-in-bio";

/**
 * Products and courses on a link in bio page: the shared listing card (the product card set approved on 25 Nov, `listing-card`) for each published, not
 * hidden item, two columns on wide screens. The card's own action opens the item's public page, where enrolling and sign-in work as everywhere else.
 */
export function BioCatalog({ title, items, preview, onOpen }: { title: string; items: BioCatalogCard[]; preview: boolean; onOpen?: (event: React.MouseEvent) => void }) {
  const t = useTranslations("LinkInBio.public");
  return <section aria-label={title || t("catalogLabel")} className="space-y-3" data-bio-catalog>
    {title && <h2 className="text-base font-semibold">{title}</h2>}
    <ul className="grid gap-3 @md:grid-cols-2">{items.map((item) => {
      const card: ListingCardItem = { type: item.kind === "course" ? "course" : "product", id: item.id, slug: item.slug, name: item.title, summary: item.summary || null, hostName: "",
        category: null, language: null, audience: null, free: true, pricing: "free", admission: null, updatedAt: "" };
      const action = <Button asChild variant="outline" className="min-h-11"><Link href={publicPath(item.kind, item.slug)} prefetch={false} tabIndex={preview ? -1 : undefined} onClick={onOpen}
        aria-label={t("viewFile", { title: item.title })}>{t("view")}</Link></Button>;
      return <li key={item.id} className="min-w-0"><ListingCard item={card} action={action} /></li>;
    })}</ul>
  </section>;
}
