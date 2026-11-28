/** Derived from Shadcn UI Kit item product-list7 (premium), registry retrieved 2026-11-25, approved 2026-11-25 (Discover screens). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Compass, Search, SearchX, TriangleAlert, X } from "lucide-react";
import type { DiscoverCard } from "@/server/discover/public";
import { discoverTypes, type DiscoverType } from "@/lib/discover-taxonomy";
import { filtersToParams, hasAnyFilter, languageName, type DiscoverFilters, type DiscoverSort } from "@/lib/discover-ui";
import { discoverCategories, discoverSorts } from "@/lib/discover-taxonomy";
import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { ChipRow } from "./discover-chips";
import { DiscoverShelf } from "./discover-shelf";
import { FilterPopover } from "./filter-popover";
import { ListingCard, type ListingCardItem } from "./listing-card";
import { QuickLook } from "./quick-look";
import { ReportListingDialog } from "./report-dialog";

export type DiscoverPage = { items: DiscoverCard[]; facets: Record<DiscoverType, number>; next: string | null };
/** The shelves above "All". The page fills them only on the plain browse view with enough listings (src/lib/discover-shelves.ts); an empty shelf is not shown. */
export type DiscoverShelves = { picks: DiscoverCard[]; personal: boolean; newest: DiscoverCard[]; free: DiscoverCard[] };
const noShelves: DiscoverShelves = { picks: [], personal: false, newest: [], free: [] };

/**
 * The search, chip filters, shelves, results and dialogs of the public Discover page. The page URL is the state (every change is a navigation that the server answers), so a
 * link, a reload and the back button all give the same results; "Load more" appends the next server page without leaving the page.
 */
export function DiscoverBrowser({ filters, initial, signedIn, failed, between, shelves = noShelves }: { filters: DiscoverFilters; initial: DiscoverPage; signedIn: boolean; failed: boolean;
  between?: React.ReactNode; shelves?: DiscoverShelves }) {
  const t = useTranslations("DiscoverScreens"), router = useRouter(), [pending, start] = useTransition();
  const go = (to: DiscoverFilters) => start(() => router.replace(`/discover?${filtersToParams(to)}`.replace(/\?$/, ""), { scroll: false }));
  const hrefFor = (to: DiscoverFilters) => `/discover?${filtersToParams(to)}`.replace(/\?$/, "");
  const all = discoverTypes.reduce((sum, type) => sum + initial.facets[type], 0);
  const chips = filters.language ? [{ key: "language", label: languageName(filters.language), clear: () => go({ ...filters, language: undefined }) }] : [];

  return <div className="space-y-8">
    <div className="space-y-3">
      <form role="search" aria-label={t("searchLabel")} action="/discover" method="get" className="flex gap-2">
        {Object.entries({ type: filters.type, category: filters.category, language: filters.language, free: filters.free === undefined ? undefined : filters.free ? "1" : "0", sort: filters.sort === "relevance" ? undefined : filters.sort })
          .filter((entry): entry is [string, string] => entry[1] !== undefined).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input key={filters.q ?? ""} name="q" type="search" defaultValue={filters.q ?? ""} maxLength={80} aria-label={t("searchLabel")} placeholder={t("searchPlaceholder")} className="min-h-11 rounded-full ps-9" />
        </div>
        <Button type="submit" size="responsive" className="rounded-full">{t("search")}</Button>
        <FilterPopover filters={filters} onChange={go} />
      </form>
      <ChipRow label={t("typesLabel")} chips={[undefined, ...discoverTypes].map((type) => ({ id: type ?? "all", label: t(`types.${type ?? "all"}`), active: filters.type === type,
        count: failed ? undefined : type ? initial.facets[type] : all, href: hrefFor({ ...filters, type }) }))} />
      <ChipRow label={t("category")} chips={[undefined, ...discoverCategories].map((category) => ({ id: category ?? "all", label: category ? t(`categories.${category}`) : t("allCategories"),
        active: filters.category === category, onSelect: () => go({ ...filters, category }) }))} />
      <ChipRow label={t("price")} chips={([undefined, true, false] as const).map((free) => ({ id: free === undefined ? "any" : free ? "free" : "paid",
        label: free === undefined ? t("anyPrice") : free ? t("free") : t("paid"), active: filters.free === free, onSelect: () => go({ ...filters, free }) }))} />
      {chips.length > 0 && <ul aria-label={t("activeFilters")} className="flex flex-wrap gap-2">
        {chips.map((chip) => <li key={chip.key}><Button type="button" variant="secondary" size="responsive" className="gap-1.5 rounded-full" aria-label={t("removeFilter", { name: chip.label })} onClick={chip.clear}>{chip.label}<X className="size-3.5" aria-hidden="true" /></Button></li>)}
      </ul>}
    </div>

    {between}

    <div aria-busy={pending}>
      <Results key={filtersToParams(filters).toString()} filters={filters} initial={initial} signedIn={signedIn} failed={failed} shelves={shelves} go={go} />
    </div>
  </div>;
}

/** The shelves and the grid for one search. Keyed by the search, so a new search starts from the server's first page, while the controls above stay mounted. */
function Results({ filters, initial, signedIn, failed, shelves, go }: { filters: DiscoverFilters; initial: DiscoverPage; signedIn: boolean; failed: boolean; shelves: DiscoverShelves;
  go: (to: DiscoverFilters) => void }) {
  const t = useTranslations("DiscoverScreens");
  const [items, setItems] = useState(initial.items), [next, setNext] = useState(initial.next), [more, setMore] = useState<"idle" | "loading" | "failed">("idle");
  const [look, setLook] = useState<ListingCardItem | null>(null), [report, setReport] = useState<ListingCardItem | null>(null);
  const here = `/discover?${filtersToParams(filters)}`.replace(/\?$/, "");
  const total = filters.type ? initial.facets[filters.type] : discoverTypes.reduce((sum, type) => sum + initial.facets[type], 0);
  const shelf = { onQuickLook: setLook, onReport: setReport };

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
  return <div className="space-y-10">
    {failed
      ? <EmptyState icon={TriangleAlert} title={t("failedTitle")} description={t("failedBody")} action={<Button asChild size="responsive"><Link href={here} prefetch={false}>{t("retry")}</Link></Button>} />
      : items.length === 0
        ? hasAnyFilter(filters)
          ? <EmptyState icon={SearchX} title={t("noResultsTitle")} description={t("noResultsBody")} action={<Button asChild variant="outline" size="responsive"><Link href="/discover" prefetch={false}>{t("resetFilters")}</Link></Button>} />
          : <EmptyState icon={Compass} title={t("emptyTitle")} description={t("emptyBody")} />
        : <>
          {shelves.picks.length > 0 && <DiscoverShelf slot="discover-recommended" title={t("shelves.picks")} subtitle={shelves.personal ? t("shelves.picksPersonal") : t("shelves.picksBody")} items={shelves.picks} {...shelf} />}
          {shelves.newest.length > 0 && <DiscoverShelf slot="discover-newest" title={t("shelves.newest")} seeAll={`/discover?${filtersToParams({ ...filters, sort: "newest" })}`} items={shelves.newest} {...shelf} />}
          {shelves.free.length > 0 && <DiscoverShelf slot="discover-free" title={t("shelves.free")} seeAll={`/discover?${filtersToParams({ ...filters, free: true })}`} items={shelves.free} {...shelf} />}
          <section aria-labelledby="discover-all" className="space-y-4">
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h2 id="discover-all" className="text-lg leading-tight font-semibold">{t("shelves.all")}</h2>
                <p role="status" className="text-sm text-muted-foreground">{t("resultCount", { count: total })}</p>
              </div>
              <div className="*:data-[slot=native-select-wrapper]:w-full">
                <NativeSelect aria-label={t("sortLabel")} value={filters.sort} onChange={(e) => go({ ...filters, sort: e.target.value as DiscoverSort })} className="min-h-11 w-40 lg:min-h-9">
                  {discoverSorts.map((key) => <NativeSelectOption key={key} value={key}>{t(`sorts.${key}`)}</NativeSelectOption>)}</NativeSelect>
              </div>
            </header>
            <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:gap-y-8 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((item) => <li key={`${item.type}:${item.id}`} className="min-w-0"><ListingCard item={item} onQuickLook={() => setLook(item)} onReport={() => setReport(item)} /></li>)}
            </ul>
            {more === "failed" && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{t("loadFailed")}<Button type="button" variant="outline" size="responsive" onClick={() => void loadMore()}>{t("retry")}</Button></AlertDescription></Alert>}
            {next && more !== "failed" && <Button type="button" variant="outline" size="responsive" disabled={more === "loading"} onClick={() => void loadMore()}>{more === "loading" ? <><Spinner decorative />{t("loadingMore")}</> : t("loadMore")}</Button>}
          </section>
        </>}
    <QuickLook item={look} onOpenChange={(open) => { if (!open) setLook(null); }} onReport={(item) => { setLook(null); setReport(item); }} />
    <ReportListingDialog item={report} signedIn={signedIn} returnTo={here} onOpenChange={(open) => { if (!open) setReport(null); }} />
  </div>;
}
