"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { request } from "@/hooks/use-request";
import { appealMessageMax } from "@/lib/community-takedown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export type HarvestPause = { reason: string | null; appeal: { status: "open" | "declined" | "restored"; createdAt: string } | null };
/** Shown to a ministry's owners and admins on a community Harvest paused: the staff reason and "Request review" (one open request at a time). */
export function HarvestPauseNotice({ pause, endpoint, writable }: { pause: HarvestPause; endpoint: string; writable: boolean }) {
  const t = useTranslations("CommunityTakedown.owner");
  const [appeal, setAppeal] = useState(pause.appeal), [open, setOpen] = useState(false), [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function send() {
    setBusy(true); setError("");
    const result = await request(`${endpoint}/review-request`, { method: "POST", body: { message: text.trim() } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setAppeal({ status: "open", createdAt: new Date().toISOString() }); setOpen(false); setText("");
  }
  const pending = appeal?.status === "open";
  return <Alert variant="destructive" data-harvest-paused><ShieldAlert aria-hidden="true" /><AlertTitle>{t("title")}</AlertTitle>
    <AlertDescription className="space-y-3">
      <p>{pause.reason ? t("reason", { reason: pause.reason }) : t("noReason")}</p>
      {pending ? <p role="status" data-review-requested>{t("requested", { date: new Date(appeal.createdAt) })}</p>
        : <>{appeal?.status === "declined" && <p>{t("declined")}</p>}
          {writable && <Button type="button" variant="outline" size="responsive" className="text-foreground" onClick={() => setOpen(true)}>{t("requestReview")}</Button>}</>}
    </AlertDescription>
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { setOpen(next); setError(""); } }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader><DialogTitle>{t("requestTitle")}</DialogTitle></DialogHeader>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <Field><FieldLabel htmlFor="harvest-review-message">{t("requestMessage")}</FieldLabel>
          <Textarea id="harvest-review-message" rows={4} maxLength={appealMessageMax} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <DialogFooter><Button type="button" variant="outline" size="responsive" disabled={busy} onClick={() => setOpen(false)}>{t("cancel")}</Button>
          <Button type="button" size="responsive" disabled={busy || !text.trim()} onClick={() => void send()}>{busy ? t("sending") : t("send")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Alert>;
}
