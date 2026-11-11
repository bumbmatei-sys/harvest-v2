import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Compass } from "lucide-react";
import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { listDiscover } from "@/server/community-joining";
import { PublicFrame } from "@/components/connect/public-frame";
import { DiscoverFilters } from "@/components/communities/discover-results";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

// C05: unified Discover, communities tab only. Results come from the sanitized projection; nothing is cached.
export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ q?: string; open?: string; after?: string }> };

export async function generateMetadata() {
  return communitiesEnabled() ? { title: (await getTranslations("Discover"))("title") } : {};
}

export default async function DiscoverPage({ searchParams }: Props) {
  if (!communitiesEnabled()) notFound();
  const params = await searchParams, t = await getTranslations("Discover");
  const query = { q: params.q?.slice(0, 80) || undefined, open: params.open === "1", after: params.after?.slice(0, 200) || undefined };
  const { items, next } = await listDiscover(getDb(), query);
  const more = new URLSearchParams({ ...(query.q ? { q: query.q } : {}), ...(query.open ? { open: "1" } : {}), ...(next ? { after: next } : {}) });
  const tabs = [["communities", false], ["courses", true], ["products", true]] as const;
  return <PublicFrame personal notice={false}>
    <div className="space-y-6">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1>
      <nav aria-label={t("types")} className="flex flex-wrap gap-2">
        {tabs.map(([id, soon]) => soon
          ? <span key={id} aria-disabled="true" className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground">{t(id)}<Badge variant="secondary">{t("comingSoon")}</Badge></span>
          : <span key={id} aria-current="page" className="inline-flex min-h-11 items-center rounded-md bg-muted px-3 text-sm font-medium">{t(id)}</span>)}
      </nav>
      <DiscoverFilters />
      {items.length === 0
        ? <Empty className="border"><EmptyHeader><EmptyMedia variant="icon"><Compass aria-hidden="true" /></EmptyMedia><EmptyTitle>{t("empty")}</EmptyTitle></EmptyHeader></Empty>
        : <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => <li key={item.id} className="min-w-0"><Card className="h-full">
            <CardHeader className="space-y-2"><CardTitle className="text-lg break-words"><h2>{item.name}</h2></CardTitle>
              {item.tagline && <p className="text-sm text-muted-foreground break-words">{item.tagline}</p>}
              <p className="text-sm break-words">{t("by", { host: item.hostName })}</p></CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2"><Badge variant="secondary">{t("free")}</Badge>{item.admission.includes("open") && <Badge variant="outline">{t("open")}</Badge>}</div>
              <Button asChild variant="outline" className="min-h-11"><Link href={`/communities/${item.slug}`} prefetch={false} aria-label={t("viewNamed", { name: item.name })}>{t("view")}</Link></Button>
            </CardContent>
          </Card></li>)}
        </ul>}
      {next && <Button asChild variant="outline" className="min-h-11"><Link href={`/discover?${more}`} prefetch={false}>{t("more")}</Link></Button>}
    </div>
  </PublicFrame>;
}
