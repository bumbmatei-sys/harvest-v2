/** Derived from Shadcn UI Kit item dashboard-modal14 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Giving screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { FlagIcon } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { request } from "@/hooks/use-request";
import { givingLimits, givingReportReasons } from "@/lib/ways-to-give";

/** "Report": any visitor, no account. Reason and an optional short note; the server rate-limits and keeps no address. Harvest staff review reports. */
export function ReportGiving({ url }: { url: string }) {
  const t = useTranslations("WaysToGive.report"), id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(""), [sent, setSent] = React.useState(false);

  function change(next: boolean) { setOpen(next); if (!next) { setReason(""); setNote(""); setError(""); setSent(false); } }
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!reason) return;
    setBusy(true); setError("");
    const result = await request<{ accepted: boolean }>(url, { method: "POST", body: { reason, ...(note.trim() ? { note: note.trim() } : {}), ...(website ? { website } : {}) } });
    setBusy(false);
    if (result.ok) setSent(true); else setError(result.status === 429 ? t("rateLimited") : t("failed"));
  }

  return (
        <Dialog open={open} onOpenChange={change}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="responsive" className="text-muted-foreground" data-giving-report><FlagIcon />{t("button")}</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <form onSubmit={(event) => void handleSubmit(event)} className="contents">
              <DialogHeader>
                <DialogTitle>{t("title")}</DialogTitle>
                <DialogDescription>
                  {t("question")}
                </DialogDescription>
              </DialogHeader>

              {sent ? <p role="status" className="text-sm">{t("sent")}</p> : <>
              {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
              <RadioGroup
                aria-label={t("reason")}
                aria-required="true"
                value={reason}
                onValueChange={setReason}
              >
                {givingReportReasons.map((item) => (
                  <Field key={item} orientation="horizontal" className="min-h-11">
                    <RadioGroupItem value={item} id={`${id}-${item}`} />
                    <FieldLabel htmlFor={`${id}-${item}`} className="font-normal">
                      {t(`reasons.${item}`)}
                    </FieldLabel>
                  </Field>
                ))}
              </RadioGroup>

              {reason && (
                    <Field>
                      <FieldLabel htmlFor={`${id}-note`}>
                        {t("note")}
                      </FieldLabel>
                      <Textarea
                        id={`${id}-note`}
                        rows={3}
                        value={note}
                        maxLength={givingLimits.reportNote}
                        onChange={(event) => setNote(event.target.value)}
                      />
                    </Field>
              )}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only" value={website} onChange={(event) => setWebsite(event.target.value)} />
              </>}

              <DialogFooter>
                {sent ? <Button type="button" size="responsive" onClick={() => change(false)}>{t("done")}</Button> : <>
                <Button
                  type="button"
                  variant="outline"
                  size="responsive"
                  onClick={() => change(false)}
                >
                  {t("cancel")}
                </Button>
                <Button type="submit" size="responsive" disabled={busy || !reason}>
                  <FlagIcon />
                  {busy ? t("sending") : t("send")}
                </Button>
                </>}
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
  );
}
