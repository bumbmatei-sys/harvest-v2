"use client";
import { useTranslations } from "next-intl";
import { ExternalLink, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { GivingMarkChip } from "@/components/giving/giving-logos";
import { PublicReportDialog, publicReportLabelKeys, type PublicReportLabels } from "@/components/public-report-dialog";
import { formatIban, givingLimits, givingReportReasons, type GivingPublicMethod } from "@/lib/ways-to-give";

/**
 * The public "Ways to give" block: the ministry's enabled giving methods with an open-in-new-tab link or copyable account details, and the short note that gifts
 * go directly to the ministry. One component for the link-in-bio page, the owner preview and any public page that embeds it (a campaign page). `inert` makes
 * links non-navigating (previews). Built from Harvest's Button and CopyButton; each method shows its brand mark (generic for a bank transfer and brands
 * without a verified mark, see giving-logos.tsx), nothing fetched.
 */
export function WaysToGive({ methods, title, ministryName, inert = false, headingLevel = 2, reportUrl }: {
  methods: GivingPublicMethod[]; title?: string; ministryName: string; inert?: boolean; headingLevel?: 2 | 3 | 4;
  /** The page's own report route (link in bio: `/l/{handle}/report`). Omitted in previews: no Report button. */
  reportUrl?: string;
}) {
  const t = useTranslations("WaysToGive.public");
  if (!methods.length) return null;
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  const inertProps = inert ? { tabIndex: -1, onClick: (event: React.MouseEvent) => event.preventDefault() } : {};
  const detail = (key: string, label: string, value: string, copy: string, mono = false) => <div key={key} className="flex min-h-11 items-center gap-2">
    <dt className="w-28 shrink-0 text-xs text-muted-foreground">{label}</dt>
    {/* The copy button sits inside the dd: a div in a dl may hold only dt and dd (axe definition-list). */}
    <dd className="flex min-w-0 flex-1 items-center gap-2"><span className={mono ? "min-w-0 flex-1 break-all font-mono text-sm" : "min-w-0 flex-1 break-words text-sm"}>{value}</span>
      <CopyButton value={copy} label={t("copy", { item: label })} /></dd>
  </div>;
  return <section className="rounded-xl border bg-card text-card-foreground" aria-label={title || t("title")} data-ways-to-give>
    <div className="flex items-center gap-2 border-b px-4 py-3"><HandCoins className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <Heading className="text-base font-semibold">{title || t("title")}</Heading></div>
    <ul className="divide-y">{methods.map((method) => {
      return <li key={method.id} className="space-y-2 px-4 py-3" data-giving-method={method.kind}>
        <div className="flex flex-wrap items-center gap-3">
          <GivingMarkChip kind={method.kind} label={t(`kinds.${method.kind}`)} />
          <span className="min-w-0 flex-1"><span className="block break-words text-base font-medium">{method.label}</span>
            <span className="block text-xs text-muted-foreground">{t(`kinds.${method.kind}`)}</span></span>
          {method.url && <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto"><a href={method.url} target="_blank" rel="noopener noreferrer" {...inertProps}>
            {t("give")}<ExternalLink aria-hidden="true" /><span className="sr-only">{t("newTab")}</span></a></Button>}
        </div>
        {(method.handle || method.iban || method.note) && <dl className="space-y-1 sm:ps-12">
          {method.handle && detail("handle", t("handle"), method.handle, method.handle)}
          {method.iban && detail("iban", t("iban"), formatIban(method.iban), method.iban, true)}
          {method.bic && detail("bic", t("bic"), method.bic, method.bic, true)}
          {method.accountHolder && detail("holder", t("accountHolder"), method.accountHolder, method.accountHolder)}
          {method.note && detail("note", t("reference"), method.note, method.note)}
        </dl>}
      </li>;
    })}</ul>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
      <p className="py-1 text-xs text-muted-foreground" data-giving-notice>{t("notice", { ministry: ministryName.trim() || t("theMinistry") })}</p>
      {reportUrl && !inert && <ReportGiving url={reportUrl} />}
    </div>
  </section>;
}

/** "Report": any visitor, no account. Reason and an optional short note; the server rate-limits and keeps no address. Harvest staff review reports. */
function ReportGiving({ url }: { url: string }) {
  const t = useTranslations("WaysToGive.report");
  const labels = Object.fromEntries(publicReportLabelKeys.map((key) => [key, t(key)])) as PublicReportLabels;
  return <PublicReportDialog url={url} labels={labels} reasons={givingReportReasons.map((value) => ({ value, label: t(`reasons.${value}`) }))} noteMax={givingLimits.reportNote}
    idPrefix="giving-report" marker={{ "data-giving-report": "" }} />;
}
