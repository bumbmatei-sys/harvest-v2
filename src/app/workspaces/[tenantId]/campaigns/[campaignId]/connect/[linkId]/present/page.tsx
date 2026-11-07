import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TriangleAlert, X } from "lucide-react";
import { getDb } from "@/db/client";
import { getConnectLink } from "@/server/connect-links";
import { pageSession } from "@/server/page-session";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { Button } from "@/components/ui/button";
import { QrImage } from "@/components/connect-admin/qr-image";
import { linkView } from "@/components/connect-admin/link-view";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ConnectLinks"))("presentTitle"), robots: { index: false, follow: false } };
}

// Projection mode: the code as large as the screen allows, black on white whatever the theme,
// with the short URL beneath for people who cannot scan. Covers the app shell.
export default async function LinkProjection({ params }: { params: Promise<{ tenantId: string; campaignId: string; linkId: string }> }) {
  const t = await getTranslations("ConnectLinks"), session = await pageSession(), { tenantId, campaignId, linkId } = await params;
  if (![tenantId, campaignId, linkId].every((id) => uuidInput.safeParse(id).success)) notFound();
  const data = await getConnectLink(getDb(), session.user.id, tenantId, campaignId, linkId)
    .catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!data || data.link.status === "archived") notFound();
  const view = linkView(data.link);
  return <div data-projection className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background text-foreground">
    <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-6">
      <h1 className="text-sm font-medium text-muted-foreground">{t("presentTitle")}</h1>
      <Button asChild variant="outline" className="min-h-11"><Link href={`/workspaces/${tenantId}/campaigns/${campaignId}/connect`}><X aria-hidden="true" />{t("presentExit")}</Link></Button>
    </div>
    {view.status !== "published" && <p role="status" className="mx-4 flex items-center gap-2 rounded-lg border border-destructive p-3 text-sm font-medium lg:mx-6">
      <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />{t("presentNotLive")}</p>}
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-8 text-center lg:px-6">
      {data.link.publicTitle && <p className="max-w-4xl break-words text-2xl font-semibold sm:text-4xl">{data.link.publicTitle}</p>}
      <p className="text-xl font-medium sm:text-3xl">{t("presentScan")}</p>
      <QrImage {...view.qr} label={t("qrAlt", { url: view.urls.shortDisplay })} className="aspect-square w-[min(80vw,62dvh)] rounded-lg" />
      <p className="text-lg text-muted-foreground sm:text-2xl">{t("presentType")}</p>
      <p className="break-all font-mono text-2xl font-semibold tracking-wide sm:text-5xl">{view.urls.shortDisplay}</p>
    </div>
  </div>;
}
