"use client";
import { useState } from "react";
import { Flag } from "lucide-react";
import { request } from "@/hooks/use-request";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

export type PublicReportLabels = { button: string; title: string; reason: string; note: string; send: string; sending: string; cancel: string; done: string;
  sent: string; rateLimited: string; failed: string };
/**
 * "Report" to Harvest staff from a public page: any visitor, no account. A reason and an optional short note; the server rate-limits and keeps no address.
 * Shared by the Ways to give block and the public community page; each passes its own route, reasons and copy.
 */
export function PublicReportDialog({ url, labels: t, reasons, noteMax, idPrefix, marker }: { url: string; labels: PublicReportLabels; reasons: { value: string; label: string }[];
  noteMax: number; idPrefix: string; marker?: Record<string, string> }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState(""), [note, setNote] = useState(""), [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [sent, setSent] = useState(false);
  function change(next: boolean) { setOpen(next); if (!next) { setReason(""); setNote(""); setError(""); setSent(false); } }
  async function submit() {
    if (!reason) return;
    setBusy(true); setError("");
    const result = await request<{ accepted: boolean }>(url, { method: "POST", body: { reason, ...(note.trim() ? { note: note.trim() } : {}), ...(website ? { website } : {}) } });
    setBusy(false);
    if (result.ok) setSent(true); else setError(result.status === 429 ? t.rateLimited : t.failed);
  }
  return <Dialog open={open} onOpenChange={change}>
    <Button type="button" variant="ghost" size="responsive" className="text-muted-foreground" onClick={() => change(true)} {...marker}><Flag aria-hidden="true" />{t.button}</Button>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
      <DialogHeader><DialogTitle>{t.title}</DialogTitle></DialogHeader>
      {sent ? <p role="status" className="text-sm">{t.sent}</p> : <div className="space-y-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <RadioGroup value={reason} onValueChange={setReason} aria-label={t.reason} aria-required="true" className="gap-2">
          {reasons.map((r) => <Label key={r.value} htmlFor={`${idPrefix}-${r.value}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal"><RadioGroupItem id={`${idPrefix}-${r.value}`} value={r.value} />{r.label}</Label>)}
        </RadioGroup>
        <div className="space-y-2"><Label htmlFor={`${idPrefix}-note`}>{t.note}</Label><Textarea id={`${idPrefix}-note`} rows={3} value={note} maxLength={noteMax} onChange={(e) => setNote(e.target.value)} /></div>
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>}
      <DialogFooter>{sent ? <Button type="button" size="responsive" onClick={() => change(false)}>{t.done}</Button>
        : <><Button type="button" variant="outline" size="responsive" onClick={() => change(false)}>{t.cancel}</Button>
          <Button type="button" size="responsive" disabled={busy || !reason} onClick={() => void submit()}>{busy ? t.sending : t.send}</Button></>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}
/** The labels every caller reads from its own `...report` message group. */
export const publicReportLabelKeys = ["button", "title", "reason", "note", "send", "sending", "cancel", "done", "sent", "rateLimited", "failed"] as const;
