"use client";
import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Download, QrCode, RefreshCw, Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/copy-button";
import { EmptyState } from "@/components/empty-state";
import { FormSection } from "@/components/form-section";
import { ReportStatCards, type ReportStat } from "@/components/crm/reports/report-stat-cards";
import { useRequest } from "@/hooks/use-request";
import { embedSnippet } from "@/lib/newsletter-signup";
import type { ListChoice } from "@/components/newsletter/signup-forms-list";
import type { SignupCounts } from "@/server/newsletter-forms";

export type NewsletterEditorData = { lists: ListChoice[]; counts: SignupCounts };

/** Share tab: the public link, the embed snippet and the QR code of a published sign-up form. Nothing here lists people. */
export function NewsletterSharePanel({ tenantId, formId, title, address, published, pending }: { tenantId: string; formId: string; title: string; address: string; published: boolean; pending: boolean }) {
  const t = useTranslations("NewsletterForms.share");
  if (!published) return <div className="mx-auto w-full max-w-3xl"><EmptyState icon={Share2} size="compact" title={t("notPublished")} /></div>;
  const embed = embedSnippet(address, title), qr = `/api/workspaces/${tenantId}/newsletter/forms/${formId}/qr`;
  return <div className="mx-auto w-full max-w-3xl space-y-8" data-share-panel>
    {pending && <Badge variant="secondary" data-share-pending>{t("pending")}</Badge>}
    <FormSection title={t("link")}>
      <div className="flex items-center gap-2"><Label htmlFor="share-link" className="sr-only">{t("link")}</Label>
        <Input id="share-link" readOnly value={address} className="min-h-11 min-w-0 font-mono text-sm" onFocus={(event) => event.currentTarget.select()} data-share-link />
        <CopyButton value={address} label={t("copyLink")} /></div>
    </FormSection>
    <FormSection title={t("embed")}>
      <div className="flex items-start gap-2"><Label htmlFor="share-embed" className="sr-only">{t("embed")}</Label>
        <Textarea id="share-embed" readOnly rows={4} value={embed} className="min-w-0 font-mono text-sm" onFocus={(event) => event.currentTarget.select()} data-share-embed />
        <CopyButton value={embed} label={t("copyEmbed")} /></div>
    </FormSection>
    <FormSection title={t("qr")}>
      <div className="flex flex-wrap items-center gap-6">
        {/* The image is the server's own SVG of the public address; it is not an uploaded or remote picture. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${qr}?format=svg`} alt={t("qrTitle", { title })} width={192} height={192} className="size-48 rounded-lg border" data-share-qr />
        <div className="flex flex-col gap-2">
          <Button asChild variant="outline" className="min-h-11"><a href={`${qr}?format=svg&download=1`} download><Download aria-hidden="true" />{t("downloadSvg")}</a></Button>
          <Button asChild variant="outline" className="min-h-11"><a href={`${qr}?format=png&download=1`} download><QrCode aria-hidden="true" />{t("downloadPng")}</a></Button>
        </div>
      </div>
    </FormSection>
  </div>;
}

/** Sign-ups tab: counts only. People appear in Audience once they confirm, never here. */
export function NewsletterSignupsPanel({ tenantId, formId, initial }: { tenantId: string; formId: string; initial: SignupCounts }) {
  const t = useTranslations("NewsletterForms.signups"), format = useFormatter(), request = useRequest();
  const [counts, setCounts] = useState(initial), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  async function refresh() {
    setBusy(true); setFailed(false);
    const result = await request<SignupCounts>(`/api/workspaces/${tenantId}/newsletter/forms/${formId}/counts`, { method: "GET" });
    setBusy(false);
    if (result.ok) setCounts(result.data); else setFailed(true);
  }
  const ratio = (value: number) => counts.total ? value / counts.total : 0;
  const stats: ReportStat[] = [
    { id: "total", name: t("total"), value: String(counts.total), color: "bg-chart-1", ratio: counts.total ? 1 : 0 },
    { id: "pending", name: t("pending"), value: String(counts.pending), color: "bg-chart-4", ratio: ratio(counts.pending) },
    { id: "confirmed", name: t("confirmed"), value: String(counts.confirmed), color: "bg-chart-2", ratio: ratio(counts.confirmed) },
    { id: "notConfirmed", name: t("notConfirmed"), value: String(counts.notConfirmed), color: "bg-chart-5", ratio: ratio(counts.notConfirmed) },
  ];
  return <div className="mx-auto w-full max-w-5xl space-y-4" data-signups-panel>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground" data-last-signup>{counts.lastSignupAt ? t("last", { when: format.dateTime(new Date(counts.lastSignupAt), { dateStyle: "medium", timeStyle: "short" }) }) : t("none")}</p>
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" className="min-h-11"><Link href={`/workspaces/${tenantId}/newsletter/audience`}>{t("openAudience")}</Link></Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void refresh()}><RefreshCw aria-hidden="true" />{t("refresh")}</Button>
      </div>
    </div>
    {failed && <p role="alert" className="text-sm text-destructive">{t("failed")}</p>}
    <ReportStatCards stats={stats} />
  </div>;
}
