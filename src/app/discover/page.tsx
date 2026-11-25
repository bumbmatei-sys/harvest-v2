import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Compass } from "lucide-react";
import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { listDiscover } from "@/server/community-joining";
import { searchDiscover } from "@/server/discover/public";
import { discoverRouteDeps } from "@/server/discover/gate";
import { freeCatalogEnabled } from "@/server/free-catalog-mode";
import { PublicFrame } from "@/components/connect/public-frame";
import { DiscoverFilters } from "@/components/communities/discover-results";
import { DiscoverCard } from "@/components/communities/discover-card";
import { CatalogDiscoverCard } from "@/components/catalog/catalog-discover-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

// C05: unified Discover, communities tab only. Results come from the sanitized projection; nothing is cached.
export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ q?: string; open?: string; after?: string; type?: string }> };

export async function generateMetadata() {
  return communitiesEnabled() ? { title: (await getTranslations("Discover"))("title") } : {};
}

export default async function DiscoverPage({ searchParams }: Props) {
  if (!communitiesEnabled()) notFound();
  const params = await searchParams, t = await getTranslations("Discover");
  // Courses and products are the free catalogue: they appear only where it is on, and only what the owner opted in and the platform approved.
  const type = freeCatalogEnabled() && (params.type === "course" || params.type === "product") ? params.type : undefined;
  const query = { q: params.q?.slice(0, 80) || undefined, open: params.open === "1", after: params.after?.slice(0, 200) || undefined };
  const catalog = type ? await searchDiscover(getDb(), { type, q: query.q, sort: "relevance", cursor: params.after?.slice(0, 40) || undefined }, discoverRouteDeps()).catch(() => ({ items: [], next: null })) : null;
  const { items, next } = catalog ? { items: [], next: catalog.next } : await listDiscover(getDb(), query);
  const more = new URLSearchParams({ ...(type ? { type } : {}), ...(query.q ? { q: query.q } : {}), ...(query.open ? { open: "1" } : {}), ...(next ? { after: next } : {}) });
  const tabs = [["communities", undefined, true], ["courses", "course", freeCatalogEnabled()], ["products", "product", freeCatalogEnabled()]] as const;
  return <PublicFrame personal notice={false}>
    <div className="space-y-6">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1>
      <nav aria-label={t("types")} className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {tabs.map(([id, tabType, live]) => live
          ? <Link key={id} href={tabType ? `/discover?type=${tabType}` : "/discover"} prefetch={false} aria-current={tabType === type ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm ${tabType === type ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground"}`}>{t(id)}</Link>
          : <span key={id} aria-disabled="true" className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground">{t(id)}<Badge variant="secondary">{t("comingSoon")}</Badge></span>)}
      </nav>
      <DiscoverFilters type={type} />
      {(catalog ? catalog.items.length === 0 : items.length === 0)
        ? <EmptyState icon={Compass} title={t("empty")} />
        : <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {catalog
            ? catalog.items.map((item) => <li key={item.id} className="min-w-0"><CatalogDiscoverCard kind={type === "course" ? "course" : "download"} item={{ id: item.id, slug: item.slug, name: item.name, summary: item.summary, hostName: item.hostName }} /></li>)
            : items.map((item) => <li key={item.id} className="min-w-0"><DiscoverCard item={item} /></li>)}
        </ul>}
      {next && <Button asChild variant="outline" className="min-h-11"><Link href={`/discover?${more}`} prefetch={false}>{t("more")}</Link></Button>}
    </div>
  </PublicFrame>;
}
