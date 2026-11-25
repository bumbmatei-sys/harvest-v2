/** Derived from Shadcn UI Kit item product-category3 (premium), registry retrieved 2026-11-25, approved 2026-11-25 (Discover screens). Visual reference only; local changes: docs/ui-sources.md. */
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { discoverCategories } from "@/lib/discover-taxonomy";
import { categoryIcons, filtersToParams, type DiscoverFilters } from "@/lib/discover-ui";

/** One tile per category of the fixed taxonomy. A tile is a link that applies the category (and keeps the rest of the search); the current one clears it. */
export async function CategoryTiles({ filters }: { filters: DiscoverFilters }) {
  const t = await getTranslations("DiscoverScreens");
  return <section aria-labelledby="discover-categories" className="space-y-3">
    <h2 id="discover-categories" className="text-lg font-semibold">{t("categoriesTitle")}</h2>
    <nav aria-label={t("categoriesLabel")}>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {discoverCategories.map((key) => {
          const Icon = categoryIcons[key], current = filters.category === key;
          const href = `/discover?${filtersToParams({ ...filters, category: current ? undefined : key })}`.replace(/\?$/, "");
          return <li key={key} className="min-w-0"><Link href={href} prefetch={false} aria-current={current ? "true" : undefined} data-category={key}
            className="flex min-h-14 items-center gap-3 rounded-xl border bg-card px-3 py-2 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=true]:border-primary aria-[current=true]:bg-selected">
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-5" /></span>
            <span className="min-w-0 break-words">{t(`categories.${key}`)}</span></Link></li>;
        })}
      </ul>
    </nav>
  </section>;
}
