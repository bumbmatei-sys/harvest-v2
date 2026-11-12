"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Flag } from "lucide-react";
import { useCrmRequest } from "@/components/crm/request";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { moderationLimits, reportReasons, type ReportReason, type ReportTarget } from "@/lib/moderation";

/** Report a post, reply or member to the community's hosts. The reported person never sees who reported them. */
export function ReportDialog({ slug, targetType, targetId, name, compact = false }: { slug: string; targetType: ReportTarget; targetId: string; name: string; compact?: boolean }) {
  const t = useTranslations("Report"), request = useCrmRequest();
  const [open, setOpen] = useState(false), [reason, setReason] = useState<ReportReason | "">(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(false);
  async function submit() {
    setBusy(true); setError("");
    const result = await request(`/api/communities/${slug}/reports`, { method: "POST", body: { targetType, targetId, reason, ...(note.trim() ? { note: note.trim() } : {}) } });
    setBusy(false);
    if (result.ok) setDone(true); else setError(result.error);
  }
  const label = t(`open.${targetType}`, { name });
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) { setReason(""); setNote(""); setError(""); setDone(false); } }}>
    <DialogTrigger asChild>{compact
      ? <Button variant="ghost" size="icon" className="size-11 text-muted-foreground" aria-label={label}><Flag aria-hidden="true" /></Button>
      : <Button variant="outline" className="min-h-11" aria-label={label}><Flag aria-hidden="true" />{t("action")}</Button>}</DialogTrigger>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{t(`title.${targetType}`)}</DialogTitle></DialogHeader>
      {done ? <p role="status" className="text-sm">{t("thanks")}</p> : <div className="space-y-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <RadioGroup value={reason} onValueChange={(v) => setReason(v as ReportReason)} aria-label={t("reason")} aria-required="true" className="gap-2">
          {reportReasons.map((r) => <Label key={r} htmlFor={`report-${r}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
            <RadioGroupItem id={`report-${r}`} value={r} />{t(`reasons.${r}`)}</Label>)}
        </RadioGroup>
        <div className="space-y-2"><Label htmlFor="report-note">{t("note")}</Label>
          <Textarea id="report-note" rows={3} value={note} maxLength={moderationLimits.note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>}
      <DialogFooter>{done
        ? <Button className="min-h-11" onClick={() => setOpen(false)}>{t("close")}</Button>
        : <Button className="min-h-11" disabled={busy || !reason} onClick={() => void submit()}>{t("send")}</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}
