"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Handshake } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { instantToZoned, zonedToInstant } from "@/lib/crm-tasks";
import { useCrmRequest } from "../request";

const sources = ["zernio", "form", "touchpoint"] as const;
const kinds = ["message", "comment", "mention", "form_submission", "signup", "call", "meeting", "visit", "other"] as const;
const purposes = ["messaging", "form_follow_up", "newsletter"] as const;
const defaults = { zernio: { kind: "message", purpose: "messaging" }, form: { kind: "form_submission", purpose: "form_follow_up" }, touchpoint: { kind: "call", purpose: "messaging" } } as const;
type Result = { stored: true; duplicate: boolean } | { stored: false; reason: "no_match" | "consent_missing" | "consent_withdrawn" };

/**
 * Link a Zernio conversation, a form or another touchpoint to this person. The server keeps it only
 * if the person's opt-in for the chosen purpose allows it; otherwise nothing is saved and we say why.
 */
export function LogActivityDialog({ tenantId, contactId }: { tenantId: string; contactId: string }) {
  const t = useTranslations("Associations");
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [source, setSource] = useState<typeof sources[number]>("zernio"), [kind, setKind] = useState<string>(defaults.zernio.kind), [purpose, setPurpose] = useState<string>(defaults.zernio.purpose);
  const [when, setWhen] = useState("");
  function change(value: boolean) {
    if (busy) return;
    setOpen(value); setError(""); setNotice("");
    if (value) { setSource("zernio"); setKind(defaults.zernio.kind); setPurpose(defaults.zernio.purpose); setWhen(instantToZoned(new Date())); }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const occurred = when ? zonedToInstant(when) : null;
    if (when && !occurred) { setError(t("chooseAValidTime")); return; }
    setBusy(true);
    const result = await crmRequest<Result>(`/api/workspaces/${tenantId}/crm/associations`, { method: "POST", body: {
      source, kind, purpose, contactId, summary: String(form.get("summary") ?? ""),
      ...(String(form.get("reference") ?? "").trim() ? { externalId: String(form.get("reference")).trim() } : {}),
      ...(occurred ? { occurredAt: occurred.toISOString() } : {}),
    } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    if (!result.data.stored) { setNotice(t(`notStored.${result.data.reason}`, { purpose: t(`purposes.${purpose as "messaging"}`) })); return; }
    setOpen(false); router.refresh();
  }
  return <Dialog open={open} onOpenChange={change}>
    <DialogTrigger asChild><Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8"><Handshake aria-hidden="true" />{t("logActivity")}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[520px]">
      <DialogHeader><DialogTitle>{t("logActivityTitle")}</DialogTitle><DialogDescription>{t("logActivityDescription")}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="gap-2"><FieldLabel htmlFor="association-source">{t("source")}</FieldLabel>
            <NativeSelect id="association-source" value={source} className="min-h-11 w-full sm:min-h-9"
              onChange={(event) => { const next = event.target.value as typeof sources[number]; setSource(next); setKind(defaults[next].kind); setPurpose(defaults[next].purpose); }}>
              {sources.map((value) => <NativeSelectOption key={value} value={value}>{t(`sources.${value}`)}</NativeSelectOption>)}
            </NativeSelect></Field>
          <Field className="gap-2"><FieldLabel htmlFor="association-kind">{t("kind")}</FieldLabel>
            <NativeSelect id="association-kind" value={kind} className="min-h-11 w-full sm:min-h-9" onChange={(event) => setKind(event.target.value)}>
              {kinds.map((value) => <NativeSelectOption key={value} value={value}>{t(`kinds.${value}`)}</NativeSelectOption>)}
            </NativeSelect></Field>
          <Field className="gap-2"><FieldLabel htmlFor="association-purpose">{t("purpose")}</FieldLabel>
            <NativeSelect id="association-purpose" value={purpose} className="min-h-11 w-full sm:min-h-9" aria-describedby="association-purpose-help" onChange={(event) => setPurpose(event.target.value)}>
              {purposes.map((value) => <NativeSelectOption key={value} value={value}>{t(`purposes.${value}`)}</NativeSelectOption>)}
            </NativeSelect>
            <FieldDescription id="association-purpose-help" className="text-xs">{t("purposeFieldHelp")}</FieldDescription></Field>
          <Field className="gap-2"><FieldLabel htmlFor="association-when">{t("when")}</FieldLabel>
            <Input id="association-when" type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} className="min-h-11 sm:min-h-9" aria-describedby="association-when-help" />
            <FieldDescription id="association-when-help" className="text-xs">{t("whenHelp")}</FieldDescription></Field>
        </div>
        <Field className="gap-2"><FieldLabel htmlFor="association-summary">{t("summary")}</FieldLabel>
          <Textarea id="association-summary" name="summary" maxLength={1000} className="min-h-20" aria-describedby="association-summary-help" />
          <FieldDescription id="association-summary-help" className="text-xs">{t("summaryHelp")}</FieldDescription></Field>
        <Field className="gap-2"><FieldLabel htmlFor="association-reference">{t("reference")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel>
          <Input id="association-reference" name="reference" maxLength={200} className="min-h-11 sm:min-h-9" aria-describedby="association-reference-help" />
          <FieldDescription id="association-reference-help" className="text-xs">{t("referenceHelp")}</FieldDescription></Field>
        <DialogFooter><DialogClose asChild><Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" disabled={busy}>{t("cancel")}</Button></DialogClose>
          <Button className="min-h-11 sm:min-h-9" disabled={busy}>{busy ? t("saving") : t("save")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
