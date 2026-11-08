import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, Eye, Info, MonitorPlay, QrCode } from "lucide-react";
import { getDb } from "@/db/client";
import { listConnectLinks, type ConnectLink } from "@/server/connect-links";
import { syntheticIntakeEnabled } from "@/server/connect-intake-mode";
import { pageSession } from "@/server/page-session";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { CopyLink } from "@/components/connect-admin/copy-link";
import { CreateLinkDialog } from "@/components/connect-admin/create-link-dialog";
import { DownloadMenu } from "@/components/connect-admin/download-menu";
import { LinkActions } from "@/components/connect-admin/link-actions";
import { QrImage } from "@/components/connect-admin/qr-image";
import { linkView } from "@/components/connect-admin/link-view";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ConnectLinks"))("pageTitle") };
}

export default async function ConnectLinksPage({ params }: { params: Promise<{ tenantId: string; campaignId: string }> }) {
  const landingT = await getTranslations("LandingEditor");
  const intakeT = await getTranslations("Intake");
  const t = await getTranslations("ConnectLinks"), session = await pageSession(), { tenantId, campaignId } = await params;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(campaignId).success) notFound();
  const data = await listConnectLinks(getDb(), session.user.id, tenantId, campaignId)
    .catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!data) notFound();
  const format = await getFormatter(), permissions = data.permissions;
  const root = `/workspaces/${tenantId}/campaigns/${campaignId}/connect`, api = `/api/workspaces/${tenantId}/campaigns/${campaignId}/connect/links`;
  const active = data.links.filter((link) => link.status !== "archived"), archived = data.links.filter((link) => link.status === "archived");
  const date = (value: Date) => format.dateTime(value, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  function row(link: ConnectLink) {
    const view = linkView(link), name = link.label ?? t("untitled");
    const checks = [
      { key: "checkCampaign" as const, state: "pass" as const },
      link.formVersionId ? { key: "checkForm" as const, state: link.formStatus === "published" ? "pass" as const : "fail" as const } : { key: "checkNoForm" as const, state: "info" as const },
      link.publicTitle ? { key: "checkTitle" as const, state: "pass" as const } : { key: "checkNoTitle" as const, state: "info" as const },
      { key: "checkResponses" as const, state: "info" as const },
    ];
    return <li key={link.id}><Card className="gap-4" aria-labelledby={`link-${link.id}`}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle><h2 id={`link-${link.id}`} className="break-words text-base font-semibold">{name}</h2></CardTitle>
          <Badge variant={view.status === "published" ? "default" : view.status === "archived" ? "outline" : "secondary"}>{t(`statuses.${view.status}`)}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t(`statusHelp.${view.status}`)}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 md:flex-row">
        <QrImage {...view.qr} label={t("qrAlt", { url: view.urls.shortDisplay })} className="size-36 shrink-0 self-start rounded-md border" />
        <div className="min-w-0 flex-1 space-y-3">
          {link.publicTitle && <p className="break-words text-sm">{t("publicTitleLine", { title: link.publicTitle })}</p>}
          <div><p className="mb-1 text-xs text-muted-foreground">{t("shortUrl")}</p>{link.status !== "archived" && <CopyLink value={view.urls.short} display={view.urls.shortDisplay} />}{link.status === "archived" && <code className="break-all font-mono text-sm text-muted-foreground line-through">{view.urls.shortDisplay}</code>}</div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <li>{link.formVersionId ? (link.formStatus === "retired" ? t("formRetired", { version: link.formVersion ?? 0 }) : t("formLine", { name: link.formName ?? "", version: link.formVersion ?? 0 })) : t("noForm")}</li>
            <li>{t("locales.en")}</li>
            <li>{link.expiresAt ? t("expires", { date: date(link.expiresAt) }) : t("noExpiry")}</li>
            <li>{t("rotations", { count: link.codeGeneration - 1 })}</li>
          </ul>
          {link.status !== "archived" && <div className="flex flex-wrap gap-2">
            {permissions.manage && <>
              <Button asChild variant="outline" size="sm" className="min-h-11"><Link href={`${root}/${link.id}/landing`}>{landingT("edit")}</Link></Button>
              <Button asChild variant="outline" size="sm" className="min-h-11"><Link href={`${root}/${link.id}/preview`}><Eye aria-hidden="true" />{t("preview")}</Link></Button>
              <Button asChild variant="outline" size="sm" className="min-h-11"><Link href={`${root}/${link.id}/present`}><MonitorPlay aria-hidden="true" />{t("present")}</Link></Button>
              <DownloadMenu endpoint={`${api}/${link.id}/export`} />
            </>}
          </div>}
          {permissions.publish && <LinkActions endpoint={`${api}/${link.id}/actions`} status={view.status} publicCode={link.publicCode}
            expiresAt={link.expiresAt ? link.expiresAt.toISOString() : null} checks={checks} />}
        </div>
      </CardContent>
    </Card></li>;
  }

  return <div className="space-y-6">
    <Button variant="link" asChild className="h-auto min-h-11 px-0 text-muted-foreground lg:min-h-0"><Link href={`/workspaces/${tenantId}/campaigns/${campaignId}`}><ArrowLeft className="size-4" aria-hidden="true" />{t("backToCampaign")}</Link></Button>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-3xl space-y-1">
        <p className="break-words text-sm text-muted-foreground">{data.campaign.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <div className="flex flex-wrap gap-2">{permissions.publish && syntheticIntakeEnabled() && <Button asChild variant="outline" className="min-h-11"><Link href={`${root}/forms`}>{intakeT("settingsLink")}</Link></Button>}{data.permissions.manage && <CreateLinkDialog endpoint={api} formVersions={data.formVersions} />}</div>
    </div>
    <Alert><Info aria-hidden="true" /><AlertDescription>{syntheticIntakeEnabled()?intakeT("adminNotice"):t("responsesNotice")}</AlertDescription></Alert>
    {!data.permissions.publish && <p className="text-sm text-muted-foreground">{t("viewerNote")}</p>}
    {active.length === 0 ? <Empty className="border border-solid bg-card py-16"><EmptyHeader><EmptyMedia variant="icon"><QrCode aria-hidden="true" /></EmptyMedia>
      <EmptyTitle><h2>{t("emptyTitle")}</h2></EmptyTitle><EmptyDescription>{t("emptyDescription")}</EmptyDescription></EmptyHeader></Empty>
      : <ul className="space-y-4">{active.map(row)}</ul>}
    {archived.length > 0 && <section className="space-y-3" aria-labelledby="archived-links"><h2 id="archived-links" className="text-lg font-semibold">{t("archivedHeading")}</h2><ul className="space-y-4">{archived.map(row)}</ul></section>}
  </div>;
}
