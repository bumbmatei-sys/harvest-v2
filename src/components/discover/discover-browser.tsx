/** Derived from Shadcn UI Kit item product-list7 (premium), registry retrieved 2026-11-25, approved 2026-11-25 (Discover screens). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Compass, Search, SearchX, TriangleAlert, X } from "lucide-react";
import type { DiscoverCard } from "@/server/discover/public";
import { discoverTypes, type DiscoverType } from "@/lib/discover-taxonomy";
import { categoryIcons, filtersToParams, hasAnyFilter, languageName, type DiscoverFilters, type DiscoverSort } from "@/lib/discover-ui";
import { discoverCategories, discoverSorts } from "@/lib/discover-taxonomy";
import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { SearchableSelect } from "@/components/searchable-select";
import { FilterPopover } from "./filter-popover";
import { ListingCard, type ListingCardItem } from "./listing-card";
import { QuickLook } from "./quick-look";
import { ReportListingDialog } from "./report-dialog";

export type DiscoverPage = { items: DiscoverCard[]; facets: Record<DiscoverType, number>; next: string | null };

/**
 * The search, filters, results and dialogs of the public Discover page. The page URL is the state (every change is a navigation that the server answers), so a link, a reload and the
 * back button all give the same results; "Load more" appends the next server page without leaving the page.
 */
export function DiscoverBrowser({ filters, initial, signedIn, failed, between }: { filters: DiscoverFilters; initial: DiscoverPage; signedIn: boolean; failed: boolean; between?: React.ReactNode }) {
  const t = useTranslations("DiscoverScreens"), router = useRouter(), [pending, start] = useTransition();
  const go = (to: DiscoverFilters) => start(() => router.replace(`/discover?${filtersToParams(to)}`.replace(/\?$/, ""), { scroll: false }));
  const hrefFor = (to: DiscoverFilters) => `/discover?${filtersToParams(to)}`.replace(/\?$/, "");
  const all = discoverTypes.reduce((sum, type) => sum + initial.facets[type], 0);
  const chips: { key: string; label: string; clear: () => void }[] = [
    ...(filters.language ? [{ key: "language", label: languageName(filters.language), clear: () => go({ ...filters, language: undefined }) }] : []),
    ...(filters.free !== undefined ? [{ key: "free", label: t("freeOnly"), clear: () => go({ ...filters, free: undefined }) }] : []),
  ];

  return <div className="space-y-6">
    <div className="space-y-3">
      <form role="search" aria-label={t("searchLabel")} action="/discover" method="get" className="flex gap-2">
        {Object.entries({ type: filters.type, category: filters.category, language: filters.language, free: filters.free === undefined ? undefined : filters.free ? "1" : "0", sort: filters.sort === "relevance" ? undefined : filters.sort })
          .filter((entry): entry is [string, string] => entry[1] !== undefined).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input key={filters.q ?? ""} name="q" type="search" defaultValue={filters.q ?? ""} maxLength={80} aria-label={t("searchLabel")} placeholder={t("searchPlaceholder")} className="min-h-11 ps-9" />
        </div>
        <Button type="submit" size="responsive">{t("search")}</Button>
        <FilterPopover filters={filters} onChange={go} onReset={() => go({ ...filters, category: undefined, language: undefined, free: undefined })} />
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t("typesLabel")} className="inline-flex h-8 max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 [scrollbar-width:none] max-lg:-my-1.5 max-lg:h-11 max-lg:rounded-[0.875rem] max-lg:bg-clip-content max-lg:py-1.5 [&::-webkit-scrollbar]:hidden">
          {[undefined, ...discoverTypes].map((type) => {
            const current = filters.type === type, count = type ? initial.facets[type] : all;
            return <Link key={type ?? "all"} href={hrefFor({ ...filters, type })} prefetch={false} aria-current={current ? "page" : undefined}
              className="group/tab inline-flex h-7 flex-none items-stretch text-sm whitespace-nowrap outline-none max-lg:-my-2 max-lg:h-11 max-lg:py-2">
              <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 group-hover/tab:bg-background/60 group-focus-visible/tab:ring-[3px] group-focus-visible/tab:ring-ring/50 group-aria-[current=page]/tab:bg-background group-aria-[current=page]/tab:font-medium group-aria-[current=page]/tab:shadow-xs">
                {t(`types.${type ?? "all"}`)}<span className="text-xs text-muted-foreground" aria-hidden="true">{failed ? "" : count}</span></span></Link>;
          })}
        </nav>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
          <SearchableSelect value={filters.category} onChange={(category) => go({ ...filters, category: category as DiscoverFilters["category"] })} ariaLabel={t("category")}
            options={discoverCategories.map((key) => ({ value: key, label: t(`categories.${key}`), icon: categoryIcons[key] }))}
            allLabel={t("allCategories")} placeholder={t("category")} searchLabel={t("searchCategories")} emptyLabel={t("noCategoryMatch")} className="w-full min-w-0 sm:w-44" />
          <div className="min-w-0 *:data-[slot=native-select-wrapper]:w-full">
            <NativeSelect aria-label={t("sortLabel")} value={filters.sort} onChange={(e) => go({ ...filters, sort: e.target.value as DiscoverSort })} className="min-h-11 w-full sm:w-40 lg:min-h-9">
            {discoverSorts.map((key) => <NativeSelectOption key={key} value={key}>{t(`sorts.${key}`)}</NativeSelectOption>)}</NativeSelect></div>
        </div>
      </div>
      {chips.length > 0 && <ul aria-label={t("activeFilters")} className="flex flex-wrap gap-2">
        {chips.map((chip) => <li key={chip.key}><Button type="button" variant="secondary" size="responsive" className="gap-1.5" aria-label={t("removeFilter", { name: chip.label })} onClick={chip.clear}>{chip.label}<X className="size-3.5" aria-hidden="true" /></Button></li>)}
      </ul>}
    </div>

    {between}

    <section aria-label={t("resultsLabel")} aria-busy={pending}>
      <Results key={filtersToParams(filters).toString()} filters={filters} initial={initial} signedIn={signedIn} failed={failed} />
    </section>
  </div>;
}

/** The grid for one search. Keyed by the search, so a new search starts from the server's first page, while the controls above (and an open filter popover) stay mounted. */
function Results({ filters, initial, signedIn, failed }: { filters: DiscoverFilters; initial: DiscoverPage; signedIn: boolean; failed: boolean }) {
  const t = useTranslations("DiscoverScreens");
  const [items, setItems] = useState(initial.items), [next, setNext] = useState(initial.next), [more, setMore] = useState<"idle" | "loading" | "failed">("idle");
  const [look, setLook] = useState<ListingCardItem | null>(null), [report, setReport] = useState<ListingCardItem | null>(null);
  const here = `/discover?${filtersToParams(filters)}`.replace(/\?$/, "");
  const total = filters.type ? initial.facets[filters.type] : discoverTypes.reduce((sum, type) => sum + initial.facets[type], 0);

  async function loadMore() {
    if (!next) return;
    setMore("loading");
    try {
      const response = await fetch(`/api/discover/listings?${filtersToParams(filters, next)}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("LOAD");
      const page = (await response.json()) as DiscoverPage;
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.type === item.type && existing.id === item.id))]);
      setNext(page.next); setMore("idle");
    } catch { setMore("failed"); }
  }
  return <div className="space-y-4">
    {failed
      ? <EmptyState icon={TriangleAlert} title={t("failedTitle")} description={t("failedBody")} action={<Button asChild size="responsive"><Link href={here} prefetch={false}>{t("retry")}</Link></Button>} />
      : items.length === 0
        ? hasAnyFilter(filters)
          ? <EmptyState icon={SearchX} title={t("noResultsTitle")} description={t("noResultsBody")} action={<Button asChild variant="outline" size="responsive"><Link href="/discover" prefetch={false}>{t("resetFilters")}</Link></Button>} />
          : <EmptyState icon={Compass} title={t("emptyTitle")} description={t("emptyBody")} />
        : <>
          <p role="status" className="text-sm text-muted-foreground">{t("resultCount", { count: total })}</p>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => <li key={`${item.type}:${item.id}`} className="min-w-0"><ListingCard item={item} onQuickLook={() => setLook(item)} onReport={() => setReport(item)} /></li>)}
          </ul>
          {more === "failed" && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{t("loadFailed")}<Button type="button" variant="outline" size="responsive" onClick={() => void loadMore()}>{t("retry")}</Button></AlertDescription></Alert>}
          {next && more !== "failed" && <Button type="button" variant="outline" size="responsive" disabled={more === "loading"} onClick={() => void loadMore()}>{more === "loading" ? <><Spinner decorative />{t("loadingMore")}</> : t("loadMore")}</Button>}
        </>}
    <QuickLook item={look} onOpenChange={(open) => { if (!open) setLook(null); }} onReport={(item) => { setLook(null); setReport(item); }} />
    <ReportListingDialog item={report} signedIn={signedIn} returnTo={here} onOpenChange={(open) => { if (!open) setReport(null); }} />
  </div>;
}
