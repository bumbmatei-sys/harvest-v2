import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { discoverGateOpen, discoverRouteDeps } from "@/server/discover/gate";
import { searchDiscover } from "@/server/discover/public";
import { optionalSession } from "@/server/page-session";
import { filtersToParams, parseFilters } from "@/lib/discover-ui";
import { PublicFrame } from "@/components/connect/public-frame";
import { DiscoverBrowser, type DiscoverPage as Page } from "@/components/discover/discover-browser";
import { LegacyDiscover, type Props } from "./legacy";

// Unified Discover (communities, courses, products). Results come from the sanitized, approved listings only (the database function re-checks every rule); nothing is cached.
// While the unified gate is closed (production) the page is the communities-only one it has always been.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return communitiesEnabled() ? { title: (await getTranslations("Discover"))("title") } : {};
}

export default async function DiscoverPage(props: Props) {
  if (!communitiesEnabled()) notFound();
  if (!discoverGateOpen()) return <LegacyDiscover {...props} />;
  const filters = parseFilters(await props.searchParams), t = await getTranslations("DiscoverScreens");
  const session = await optionalSession().catch(() => null);
  let initial: Page = { items: [], facets: { community: 0, course: 0, product: 0 }, next: null }, failed = false;
  try { initial = await searchDiscover(getDb(), filtersToParams(filters), discoverRouteDeps()); } catch { failed = true; }
  return <PublicFrame personal notice={false}>
    <div className="space-y-8">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1>
      <DiscoverBrowser filters={filters} initial={initial} signedIn={session !== null} failed={failed} />
    </div>
  </PublicFrame>;
}
