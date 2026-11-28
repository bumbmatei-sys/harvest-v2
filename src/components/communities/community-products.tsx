/** Derived from Shadcn UI Kit item product-list1 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Community screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { PackageOpen } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ShelfAction, ShelfBadges } from "@/components/communities/shelf-action";
import { publicPath } from "@/lib/catalog";
import type { ShelfItem } from "@/server/community-shelf";

/** C16 Products as the kit's product grid: a tile per free download, its name and summary, Free, its marks and the access step. */
export function CommunityProducts({ items }: { items: ShelfItem[] }) {
  const t = useTranslations("CommunityShelf");
  const title = t("productsTitle");
  return (
    <section className="w-full min-w-0 p-4 lg:p-6" aria-labelledby="shelf-title">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h2 id="shelf-title" className="text-2xl font-bold">{title}</h2>
      </div>
      {items.length === 0 ? <EmptyState icon={PackageOpen} title={t("emptyProducts")} />
        : <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4" aria-label={title}>
          {items.map((product) => (
            <li key={product.id} className="group relative min-w-0 space-y-4">
              <figure className="bg-muted text-muted-foreground flex aspect-video w-full items-center justify-center overflow-hidden rounded-md group-hover:opacity-75 md:aspect-3/4">
                <PackageOpen className="size-10" aria-hidden="true" />
              </figure>
              <div className="flex justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium">
                    <Link href={publicPath(product.kind, product.slug)} prefetch={false}>
                      <span aria-hidden="true" className="absolute inset-0" />
                      {product.title}
                    </Link>
                  </h3>
                  {product.summary && <p className="text-muted-foreground text-sm">{product.summary}</p>}
                </div>
                <p className="font-medium">{t("free")}</p>
              </div>
              <div className="relative z-10 space-y-3">
                <ShelfBadges item={product} />
                <ShelfAction item={product} />
              </div>
            </li>
          ))}
        </ul>}
    </section>
  );
}
