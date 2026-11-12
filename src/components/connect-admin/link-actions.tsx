"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, CalendarClock, CircleCheck, CircleDashed, CircleX, Info, Pause, RefreshCw, Rocket } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRequest } from "@/hooks/use-request";
import type { EffectiveLinkStatus, LinkAction, LinkOutcome } from "@/lib/connect-links";

type Check = { key: "checkCampaign" | "checkForm" | "checkNoForm" | "checkTitle" | "checkNoTitle" | "checkResponses"; state: "pass" | "fail" | "info" };
const reasons = ["stale", "link_archived", "campaign_archived", "form_not_published", "expiry_in_past", "invalid_transition"] as const;
type Reason = typeof reasons[number];

/** A local datetime-local value for an ISO time, so the field shows the organizer's own clock. */
function localValue(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso), offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function LinkActions({ endpoint, status, publicCode, expiresAt, checks }: {
  endpoint: string; status: EffectiveLinkStatus; publicCode: string; expiresAt: string | null; checks: Check[];
}) {
  const t = useTranslations("ConnectLinks");
  const router = useRouter(), request = useRequest(), id = useId();
  const [busy, setBusy] = useState<LinkAction | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [publishOpen, setPublishOpen] = useState(false), [expiry, setExpiry] = useState(localValue(expiresAt));
  const blocked = checks.some((check) => check.state === "fail");

  async function run(action: LinkAction) {
    setBusy(action); setError(""); setNotice("");
    const expiresAtValue = action === "publish" && expiry ? new Date(expiry).toISOString() : null;
    const result = await request<{ outcome: LinkOutcome }>(endpoint, { method: "POST", body: { action, expectedCode: publicCode, ...(action === "publish" ? { expiresAt: expiresAtValue } : {}) } });
    setBusy(null);
    if (!result.ok) {
      const reason = result.details?.reason;
      setError(typeof reason === "string" && (reasons as readonly string[]).includes(reason) ? t(`reasons.${reason as Reason}`) : result.error);
      return false;
    }
    const outcome = result.data.outcome;
    if (outcome === "published" || outcome === "disabled" || outcome === "rotated" || outcome === "archived" || outcome === "unchanged") setNotice(t(`done.${outcome}`));
    router.refresh();
    return true;
  }

  const confirm = (action: Exclude<LinkAction, "publish">, Icon: typeof Pause, variant: "outline" | "destructive") => {
    const key = action === "disable" ? "disable" : action;
    return <AlertDialog>
      <AlertDialogTrigger asChild><Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy !== null}><Icon aria-hidden="true" />{t(key)}</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t(`${key}Title`)}</AlertDialogTitle><AlertDialogDescription>{t(`${key}Description`)}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction className="min-h-11" variant={variant} onClick={() => void run(action)}>{t(`${key}Submit`)}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>;
  };

  if (status === "archived") return null;
  const publishLabel = status === "draft" ? t("publish") : status === "published" ? t("updateExpiry") : t("republish");
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      <Dialog open={publishOpen} onOpenChange={(value) => { if (!busy) { setPublishOpen(value); setError(""); setExpiry(localValue(expiresAt)); } }}>
        <DialogTrigger asChild><Button type="button" size="sm" variant={status === "published" ? "outline" : "default"} className="min-h-11" disabled={busy !== null}>{status === "published" ? <CalendarClock aria-hidden="true" /> : <Rocket aria-hidden="true" />}{publishLabel}</Button></DialogTrigger>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[560px]">
          <DialogHeader><DialogTitle>{t("publishTitle")}</DialogTitle><DialogDescription>{t("publishDescription")}</DialogDescription></DialogHeader>
          <ul className="divide-y rounded-lg border" aria-label={t("publishTitle")}>
            {checks.map((check) => {
              const Icon = check.state === "pass" ? CircleCheck : check.state === "fail" ? CircleX : check.key === "checkResponses" ? Info : CircleDashed;
              return <li key={check.key} className="flex items-start gap-3 p-3 text-sm">
                <Icon className={check.state === "fail" ? "mt-0.5 size-4 shrink-0 text-destructive" : "mt-0.5 size-4 shrink-0 text-muted-foreground"} aria-hidden="true" />
                <span className={check.state === "fail" ? "font-medium" : undefined}>{t(check.key)}</span>
              </li>;
            })}
          </ul>
          <Field><FieldLabel htmlFor={`${id}-expiry`}>{t("expiry")}</FieldLabel>
            <Input id={`${id}-expiry`} type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} className="min-h-11" aria-describedby={`${id}-expiry-help`} />
            <FieldDescription id={`${id}-expiry-help`}>{t("expiryHelp")}</FieldDescription></Field>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost" className="min-h-11" disabled={busy !== null}>{t("cancel")}</Button></DialogClose>
            <Button type="button" className="min-h-11" disabled={busy !== null || blocked} onClick={() => void run("publish").then((ok) => { if (ok) setPublishOpen(false); })}>
              {busy === "publish" ? t("publishing") : t("publishSubmit")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {status === "published" || status === "expired" ? confirm("disable", Pause, "outline") : null}
      {confirm("rotate", RefreshCw, "outline")}
      {confirm("archive", Archive, "destructive")}
    </div>
    {!publishOpen && error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <p role="status" className="text-sm text-muted-foreground">{notice}</p>
  </div>;
}
