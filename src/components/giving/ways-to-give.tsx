"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Flag, HandCoins } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/copy-button";
import { GivingMarkChip } from "@/components/giving/giving-logos";
import { request } from "@/hooks/use-request";
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
    <dd className={mono ? "min-w-0 flex-1 break-all font-mono text-sm" : "min-w-0 flex-1 break-words text-sm"}>{value}</dd>
    <CopyButton value={copy} label={t("copy", { item: label })} />
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
  const [open, setOpen] = useState(false), [reason, setReason] = useState(""), [note, setNote] = useState(""), [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [sent, setSent] = useState(false);
  function change(next: boolean) { setOpen(next); if (!next) { setReason(""); setNote(""); setError(""); setSent(false); } }
  async function submit() {
    if (!reason) return;
    setBusy(true); setError("");
    const result = await request<{ accepted: boolean }>(url, { method: "POST", body: { reason, ...(note.trim() ? { note: note.trim() } : {}), ...(website ? { website } : {}) } });
    setBusy(false);
    if (result.ok) setSent(true); else setError(result.status === 429 ? t("rateLimited") : t("failed"));
  }
  return <Dialog open={open} onOpenChange={change}>
    <Button type="button" variant="ghost" size="responsive" className="text-muted-foreground" onClick={() => change(true)} data-giving-report><Flag aria-hidden="true" />{t("button")}</Button>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
      <DialogHeader><DialogTitle>{t("title")}</DialogTitle></DialogHeader>
      {sent ? <p role="status" className="text-sm">{t("sent")}</p> : <div className="space-y-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <RadioGroup value={reason} onValueChange={setReason} aria-label={t("reason")} aria-required="true" className="gap-2">
          {givingReportReasons.map((r) => <Label key={r} htmlFor={`giving-report-${r}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal"><RadioGroupItem id={`giving-report-${r}`} value={r} />{t(`reasons.${r}`)}</Label>)}
        </RadioGroup>
        <div className="space-y-2"><Label htmlFor="giving-report-note">{t("note")}</Label><Textarea id="giving-report-note" rows={3} value={note} maxLength={givingLimits.reportNote} onChange={(e) => setNote(e.target.value)} /></div>
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>}
      <DialogFooter>{sent ? <Button type="button" size="responsive" onClick={() => change(false)}>{t("done")}</Button>
        : <><Button type="button" variant="outline" size="responsive" onClick={() => change(false)}>{t("cancel")}</Button>
          <Button type="button" size="responsive" disabled={busy || !reason} onClick={() => void submit()}>{busy ? t("sending") : t("send")}</Button></>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}
