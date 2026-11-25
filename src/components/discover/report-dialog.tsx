"use client";
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { request } from "@/hooks/use-request";
import { reportReasons } from "@/lib/discover-taxonomy";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { ListingCardItem } from "./listing-card";

/**
 * Report a Discover listing to the platform. Signed-in only: a visitor gets the sign-in link instead of the form. The server allows one open report per person and listing and ten a day,
 * and the ministry never learns who reported; the dialog shows the duplicate and rate-limit answers in plain words. The form remounts for each listing, so nothing carries over.
 */
export function ReportListingDialog({ item, signedIn, returnTo, onOpenChange }: { item: ListingCardItem | null; signedIn: boolean; returnTo: string; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("DiscoverScreens");
  return <Dialog open={item !== null} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
      <DialogHeader><DialogTitle className="break-words">{t("report.title")}</DialogTitle></DialogHeader>
      {item && <ReportBody key={`${item.type}:${item.id}`} item={item} signedIn={signedIn} returnTo={returnTo} close={() => onOpenChange(false)} />}
    </DialogContent>
  </Dialog>;
}

function ReportBody({ item, signedIn, returnTo, close }: { item: ListingCardItem; signedIn: boolean; returnTo: string; close: () => void }) {
  const t = useTranslations("DiscoverScreens");
  const [reason, setReason] = useState<string>(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [outcome, setOutcome] = useState<"" | "reported" | "duplicate">("");
  async function submit() {
    if (!reason) return;
    setBusy(true); setError("");
    const result = await request<{ status: "reported" | "duplicate" }>("/api/discover/reports", { method: "POST", body: { type: item.type, id: item.id, reason, ...(note.trim() ? { note: note.trim() } : {}) } });
    setBusy(false);
    if (result.ok) setOutcome(result.data.status);
    else setError(result.status === 429 ? t("report.rateLimited") : result.status === 404 ? t("report.gone") : result.status === 401 ? t("report.signIn") : t("report.failed"));
  }
  return <>
    <p className="text-sm font-medium break-words">{item.name}</p>
    {!signedIn
      ? <Button asChild size="responsive" className="w-full"><Link href={`/sign-in?next=${encodeURIComponent(returnTo)}`} prefetch={false}>{t("report.signIn")}</Link></Button>
      : outcome
        ? <p role="status" className="text-sm">{outcome === "duplicate" ? t("report.duplicate") : t("report.sent")}</p>
        : <div className="space-y-4">
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <RadioGroup value={reason} onValueChange={setReason} aria-label={t("report.reason")} aria-required="true" className="gap-2">
            {reportReasons.map((r) => <Label key={r} htmlFor={`discover-report-${r}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal"><RadioGroupItem id={`discover-report-${r}`} value={r} />{t(`report.reasons.${r}`)}</Label>)}
          </RadioGroup>
          <div className="space-y-2"><Label htmlFor="discover-report-note">{t("report.note")}</Label><Textarea id="discover-report-note" rows={3} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></div>
        </div>}
    {signedIn && <DialogFooter>{outcome
      ? <Button size="responsive" onClick={close}>{t("report.done")}</Button>
      : <><Button type="button" variant="outline" size="responsive" onClick={close}>{t("report.cancel")}</Button><Button type="button" size="responsive" disabled={busy || !reason} onClick={() => void submit()}>{busy ? t("report.sending") : t("report.send")}</Button></>}</DialogFooter>}
  </>;
}
