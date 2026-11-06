import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, Flag } from "lucide-react";
import { getDb } from "@/db/client";
import { getCampaign } from "@/server/campaigns";
import { pageSession } from "@/server/page-session";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Campaigns"))("pageTitle") };
}

export default async function CampaignPage({ params }: { params: Promise<{ tenantId: string; campaignId: string }> }) {
  const t = await getTranslations("Campaigns"), session = await pageSession(), { tenantId, campaignId } = await params;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(campaignId).success) notFound();
  const campaign = await getCampaign(getDb(), session.user.id, tenantId, campaignId)
    .catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!campaign) notFound();
  const format = await getFormatter();
  const details = [
    [t("location"), [campaign.cityRegion, campaign.country].filter(Boolean).join(", ") || t("notSet")],
    [t("dates"), [campaign.startDate, campaign.endDate].filter((date) => date !== null).map((date) => format.dateTime(new Date(`${date}T00:00:00Z`), { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })).join(" – ") || t("notSet")],
    [t("timeZone"), campaign.timeZone ?? t("notSet")],
    [t("structure"), campaign.structure ? t(`structures.${campaign.structure}`) : t("notSet")],
    [t("owner"), campaign.ownerUserId === session.user.id ? t("you") : campaign.ownerName.trim() || t("workspaceMember")],
  ];
  return <div className="space-y-4">
    <Button variant="link" asChild className="h-auto min-h-11 px-0 text-muted-foreground lg:min-h-0"><Link href={`/workspaces/${tenantId}/campaigns`}><ArrowLeft className="size-4" aria-hidden="true" />{t("backToCampaigns")}</Link></Button>
    <div><h1 className="break-words text-2xl font-semibold tracking-tight">{campaign.name}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2"><Badge variant="outline">{t(`types.${campaign.type}`)}</Badge><Badge variant="secondary">{t(`statuses.${campaign.status}`)}</Badge></div>
      {campaign.description && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{campaign.description}</p>}
    </div>
    <Card><CardHeader><CardTitle>{t("details")}</CardTitle></CardHeader><CardContent>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{details.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{value}</dd></div>)}</dl>
      {campaign.mission && <div className="mt-4"><h2 className="text-xs text-muted-foreground">{t("mission")}</h2><p className="mt-1 whitespace-pre-wrap break-words text-sm">{campaign.mission}</p></div>}
    </CardContent></Card>
    <Empty className="border border-solid bg-card py-16"><EmptyHeader><EmptyMedia variant="icon"><Flag aria-hidden="true" /></EmptyMedia>
      <EmptyTitle><h2>{t("dashboardTitle")}</h2></EmptyTitle><EmptyDescription>{t("dashboardDescription")}</EmptyDescription>
    </EmptyHeader></Empty>
    {campaign.status === "draft" && <p className="text-xs text-muted-foreground">{t("draftNote")}</p>}
  </div>;
}
