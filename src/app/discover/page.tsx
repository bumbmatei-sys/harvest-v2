import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { discoverGateOpen, discoverRouteDeps } from "@/server/discover/gate";
import { recommendDiscover, searchDiscover } from "@/server/discover/public";
import { optionalSession } from "@/server/page-session";
import { publicReadCharge } from "@/server/public-read-limit";
import { filtersToParams, parseFilters } from "@/lib/discover-ui";
import { changedThisWeek, fillShelf, freeShelfUseful, shelfSize, shelvesAllowed } from "@/lib/discover-shelves";
import { PublicFrame } from "@/components/connect/public-frame";
import { DiscoverBrowser, type DiscoverPage as Page, type DiscoverShelves } from "@/components/discover/discover-browser";
import { LegacyDiscover, type Props } from "./legacy";

// Unified Discover (communities, courses, products). Results come from the sanitized, approved listings only (the database function re-checks every rule); nothing is cached.
// While the unified gate is closed (production) the page is the communities-only one it has always been.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return communitiesEnabled() ? { title: (await getTranslations("Discover"))("title") } : {};
}

export default async function DiscoverPage(props: Props) {
  if (!communitiesEnabled()) notFound();
  // Shares the per-visitor Discover budget with the listing and search APIs; over it nothing is read.
  const limited = (await publicReadCharge(await headers(), "discover")).limited;
  if (!discoverGateOpen()) return <LegacyDiscover {...props} limited={limited} />;
  const filters = parseFilters(await props.searchParams), t = await getTranslations("DiscoverScreens");
  const session = await optionalSession().catch(() => null);
  let initial: Page = { items: [], facets: { community: 0, course: 0, product: 0 }, next: null }, failed = limited;
  if (!limited) try { initial = await searchDiscover(getDb(), filtersToParams(filters), discoverRouteDeps()); } catch { failed = true; }
  // Shelves (Picks, New this week, Free to start) show on the plain browse view only (a type chip is allowed), and only when the view holds enough listings that they do
  // not just repeat the grid (src/lib/discover-shelves.ts). Picks is C20's recommendation (approved public listings; for a signed-in person, ranked by what they joined).
  // A failed shelf read hides that shelf, never the page.
  let shelves: DiscoverShelves = { picks: [], personal: false, newest: [], free: [] };
  const total = filters.type ? initial.facets[filters.type] : initial.facets.community + initial.facets.course + initial.facets.product;
  if (!limited && !failed && shelvesAllowed(filters, total)) {
    const db = getDb(), deps = discoverRouteDeps();
    const [picks, newest, free] = await Promise.all([
      recommendDiscover(db, session?.user.id ?? null, filters.type, deps, shelfSize).catch(() => null),
      searchDiscover(db, filtersToParams({ ...filters, sort: "newest" }), deps).catch(() => null),
      searchDiscover(db, filtersToParams({ ...filters, free: true }), deps).catch(() => null),
    ]);
    const freeTotal = free ? (filters.type ? free.facets[filters.type] : free.facets.community + free.facets.course + free.facets.product) : 0;
    shelves = {
      picks: fillShelf(picks?.items ?? []), personal: picks?.personal ?? false,
      newest: fillShelf(changedThisWeek(newest?.items ?? [])),
      free: free && freeShelfUseful(freeTotal, total) ? fillShelf(free.items) : [],
    };
  }
  return <PublicFrame personal notice={false}>
    <div className="space-y-6">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1>
      <DiscoverBrowser filters={filters} initial={initial} signedIn={session !== null} failed={failed} shelves={shelves} />
    </div>
  </PublicFrame>;
}
