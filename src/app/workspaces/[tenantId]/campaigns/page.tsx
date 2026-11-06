import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronRight, Flag, LockKeyhole } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { listCampaigns } from "@/server/campaigns";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { campaignPage } from "@/lib/campaigns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Campaigns"))("pageTitle") };
}

export default async function CampaignsPage({ params, searchParams }: {
  params: Promise<{ tenantId: string }>; searchParams: Promise<{ page?: string }>;
}) {
  const t = await getTranslations("Campaigns"), session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) notFound();
  const page = campaignPage.safeParse((await searchParams).page);
  const result = await listCampaigns(getDb(), session.user.id, tenantId, page.success ? page.data : 1)
    .catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!result) notFound();
  const root = `/workspaces/${tenantId}/campaigns`;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("description")}</p></div>
      <Badge variant="secondary">{t("count", { count: result.total })}</Badge>
    </div>
    {result.campaigns.length ? <ItemGroup aria-label={t("title")} className="gap-2">
      {result.campaigns.map((campaign) => <div key={campaign.id} role="listitem"><Item variant="outline" asChild>
        <Link href={`${root}/${campaign.id}`} className="bg-card">
          <ItemContent className="min-w-0"><ItemTitle className="max-w-full break-words">{campaign.name}</ItemTitle>
            <ItemDescription>{t(`types.${campaign.type}`)}</ItemDescription></ItemContent>
          <Badge variant="secondary">{t(`statuses.${campaign.status}`)}</Badge><ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      </Item></div>)}
    </ItemGroup> : <Empty className="border border-solid bg-card py-16">
      <EmptyHeader><EmptyMedia variant="icon"><Flag aria-hidden="true" /></EmptyMedia>
        <EmptyTitle><h2>{t(result.total ? "emptyPage" : "emptyTitle")}</h2></EmptyTitle><EmptyDescription>{t("emptyDescription")}</EmptyDescription>
      </EmptyHeader>
    </Empty>}
    {(result.total > result.pageSize || result.page > 1) && <Pagination aria-label={t("title")}><PaginationContent>
      {result.page > 1 && <PaginationItem><Button variant="outline" asChild><Link href={`${root}?page=${result.page - 1}`}>{t("previous")}</Link></Button></PaginationItem>}
      <PaginationItem><span className="px-3 text-sm text-muted-foreground">{t("page", { page: result.page })}</span></PaginationItem>
      {result.page * result.pageSize < result.total && <PaginationItem><Button variant="outline" asChild><Link href={`${root}?page=${result.page + 1}`}>{t("next")}</Link></Button></PaginationItem>}
    </PaginationContent></Pagination>}
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole className="size-3.5" aria-hidden="true" />{t("private")}</p>
  </div>;
}
