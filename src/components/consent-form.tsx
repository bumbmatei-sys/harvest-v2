"use client";
import { errorMessage } from "@/i18n/messages";
import { useTranslations, useFormatter } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarIcon, Plus } from "lucide-react";
import type { ConsentLabel } from "@/lib/consent-labels";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { consentNoticeVersions, consentPurposes } from "@/lib/contact-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
export function ConsentForm({ tenantId, contactId }: { tenantId: string; contactId: string }) {
  const t = useTranslations("ComponentsConsentForm");
  const format = useFormatter();
  const labels = useTranslations("ConsentLabels");
  const router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [date, setDate] = useState<Date>(), [time, setTime] = useState(""), [pickerOpen, setPickerOpen] = useState(false);
  const [maximum, setMaximum] = useState(new Date(0));
  const dateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (!date || !time) { setError(t("chooseTheConsentDateAndTime")); return; }
      data.occurredAt = `${dateKey(date)}T${time}:00Z`;
      if (Date.parse(data.occurredAt) > Date.now() + 5 * 60_000) { setError(t("consentTimeCannotBeMoreThanFiveMinutes")); return; }
      const response = await fetch(`/api/workspaces/${tenantId}/contacts/${contactId}/consents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (response.status === 401) { router.replace("/sign-in"); return; }
      if (!response.ok) { setError(errorMessage((await response.json()).error) ?? t("couldNotRecordConsentTryAgain")); return; }
      setOpen(false); router.refresh();
    } catch { setError(t("couldNotConnectPleaseTryAgain")); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (value) {
    setError("");
    const now = new Date(), utc = now.toISOString();
    setDate(new Date(`${utc.slice(0, 10)}T12:00:00`)); setTime(utc.slice(11, 16)); setMaximum(new Date(now.getTime() + 5 * 60_000));
  } }}>
    <DialogTrigger asChild><Button variant="outline" size="sm"><Plus aria-hidden="true" />{t("recordConsent")}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[460px]"><DialogHeader><DialogTitle>{t("recordConsent")}</DialogTitle><DialogDescription>{t("recordThePersonSChoiceAndSupportingEvidence")}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="grid grid-cols-2 gap-4"><Field className="gap-2"><FieldLabel htmlFor="consent-channel">{t("channel")}</FieldLabel><Select name="channel" defaultValue="email"><SelectTrigger id="consent-channel" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="email">{t("email")}</SelectItem><SelectItem value="sms">{t("sMS")}</SelectItem><SelectItem value="social">{t("social")}</SelectItem></SelectContent></Select></Field>
        <Field className="gap-2"><FieldLabel htmlFor="consent-status">{t("status")}</FieldLabel><Select name="status" defaultValue="unknown"><SelectTrigger id="consent-status" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">{t("unknown")}</SelectItem><SelectItem value="granted">{t("granted")}</SelectItem><SelectItem value="withdrawn">{t("withdrawn")}</SelectItem></SelectContent></Select></Field></div>
        <div className="grid grid-cols-2 gap-4"><Field className="gap-2"><FieldLabel htmlFor="consent-purpose">{t("purpose")}</FieldLabel><Select name="purpose" defaultValue="marketing"><SelectTrigger id="consent-purpose" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{consentPurposes.map((purpose) => <SelectItem key={purpose} value={purpose}>{labels(purpose as ConsentLabel)}</SelectItem>)}</SelectContent></Select></Field><Field className="gap-2"><FieldLabel htmlFor="consent-version">{t("wordingVersion")}</FieldLabel><Select name="noticeVersion" defaultValue="notice-v1"><SelectTrigger id="consent-version" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{consentNoticeVersions.map((version) => <SelectItem key={version} value={version}>{labels(version as ConsentLabel)}</SelectItem>)}</SelectContent></Select></Field></div>
        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-4">
          <Field className="gap-2"><FieldLabel htmlFor="consent-date">{t("consentDateUTC")}</FieldLabel>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}><PopoverTrigger asChild><Button id="consent-date" data-date={date ? dateKey(date) : undefined} type="button" variant="outline" className="justify-start font-normal"><CalendarIcon aria-hidden="true" />{date ? format.dateTime(date, "calendarDate") : t("chooseDate")}</Button></PopoverTrigger>
              <PopoverContent aria-label={t("chooseConsentDate")} className="w-auto p-0" align="start"><Calendar mode="single" selected={date} defaultMonth={date} disabled={(day) => dateKey(day) > maximum.toISOString().slice(0, 10)} onSelect={(day) => { setDate(day); if (day) setPickerOpen(false); }} autoFocus /></PopoverContent>
            </Popover>
          </Field>
          <Field className="gap-2"><FieldLabel htmlFor="consent-time">{t("timeUTC")}</FieldLabel><Input id="consent-time" type="time" required step="60" value={time} max={date && dateKey(date) === maximum.toISOString().slice(0, 10) ? maximum.toISOString().slice(11, 16) : "23:59"} onChange={(event) => setTime(event.target.value)} /></Field>
        </div>
        <p className="text-xs text-muted-foreground">{t("whenThePersonMadeThisChoiceRecordingTime")}</p>
        <Alert><AlertDescription>{t("useAnEvidenceReferenceWherePossibleAvoidNames")}</AlertDescription></Alert>
        <Field className="gap-2"><FieldLabel htmlFor="consent-source">{t("source")}</FieldLabel><Input id="consent-source" name="source" required maxLength={200} placeholder={t("whereThePersonSharedTheirChoice")} /></Field>
        <Field className="gap-2"><FieldLabel htmlFor="consent-evidence">{t("evidence")}</FieldLabel><Textarea id="consent-evidence" name="evidence" required maxLength={2000} placeholder={t("referenceOrDetailsSupportingThisRecord")} /></Field>
        <Separator /><DialogFooter><DialogClose asChild><Button type="button" variant="ghost" disabled={busy}>{t("cancel")}</Button></DialogClose><Button disabled={busy}>{busy ? t("saving") : t("saveConsentRecord")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
