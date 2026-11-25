import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Compass } from "lucide-react";
import { getDb } from "@/db/client";
import { listDiscover } from "@/server/community-joining";
import { PublicFrame } from "@/components/connect/public-frame";
import { DiscoverFilters } from "@/components/communities/discover-results";
import { DiscoverCard } from "@/components/communities/discover-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

// C05: unified Discover, communities tab only. Results come from the sanitized projection; nothing is cached.
export const dynamic = "force-dynamic";
export type Props = { searchParams: Promise<{ q?: string; open?: string; after?: string }> };

/** The communities-only page, unchanged: it is what `/discover` renders while the unified Discover gate is closed (production today). */
export async function LegacyDiscover({ searchParams }: Props) {
  const params = await searchParams, t = await getTranslations("Discover");
  const query = { q: params.q?.slice(0, 80) || undefined, open: params.open === "1", after: params.after?.slice(0, 200) || undefined };
  const { items, next } = await listDiscover(getDb(), query);
  const more = new URLSearchParams({ ...(query.q ? { q: query.q } : {}), ...(query.open ? { open: "1" } : {}), ...(next ? { after: next } : {}) });
  const tabs = [["communities", false], ["courses", true], ["products", true]] as const;
  return <PublicFrame personal notice={false}>
    <div className="space-y-6">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1>
      <nav aria-label={t("types")} className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {tabs.map(([id, soon]) => soon
          ? <span key={id} aria-disabled="true" className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground">{t(id)}<Badge variant="secondary">{t("comingSoon")}</Badge></span>
          : <span key={id} aria-current="page" className="inline-flex min-h-11 items-center rounded-md bg-background px-3 text-sm font-medium shadow-xs">{t(id)}</span>)}
      </nav>
      <DiscoverFilters />
      {items.length === 0
        ? <EmptyState icon={Compass} title={t("empty")} />
        : <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => <li key={item.id} className="min-w-0"><DiscoverCard item={item} /></li>)}
        </ul>}
      {next && <Button asChild variant="outline" className="min-h-11"><Link href={`/discover?${more}`} prefetch={false}>{t("more")}</Link></Button>}
    </div>
  </PublicFrame>;
}
