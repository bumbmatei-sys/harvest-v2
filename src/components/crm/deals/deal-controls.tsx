"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, RotateCcw, X } from "lucide-react";
import { AMOUNT, type StageKind } from "@/lib/crm-deals";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { InlineField } from "../inline-field";
import { useRecord } from "../record-context";
import { RecordPicker } from "../record-picker";

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-x-3 py-0.5 sm:grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)]">
    <label htmlFor={htmlFor} className="flex min-h-8 items-center text-xs text-muted-foreground"><span className="truncate">{label}</span></label><div className="min-w-0">{children}</div>
  </div>;
}
function Problem({ busy, error }: { busy: boolean; error: string }) {
  const t = useTranslations("Deals");
  return <>{busy && <p role="status" className="px-2 text-xs text-muted-foreground">{t("saving")}</p>}{error && <p role="alert" className="px-2 text-xs text-destructive">{error}</p>}</>;
}

/** Stage: a select that moves the deal through the move API; closing asks for an optional reason. */
export function DealStageControl({ stageId, stages }: { stageId: string; stages: { id: string; name: string; kind: StageKind; archived: boolean }[] }) {
  const t = useTranslations("Deals");
  const { sendTo, writable } = useRecord();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [closing, setClosing] = useState<{ stageId: string; reason: string } | null>(null);
  const current = stages.find((stage) => stage.id === stageId);
  async function move(target: string, reason: string | null) {
    setBusy(true); setError("");
    const failure = await sendTo("/move", { stageId: target, ...(reason ? { closedReason: reason } : {}) }, "POST");
    setBusy(false);
    if (failure) setError(failure);
  }
  function choose(target: string) {
    const stage = stages.find((item) => item.id === target);
    if (!stage || target === stageId) return;
    if (stage.kind !== "open") setClosing({ stageId: target, reason: "" }); else void move(target, null);
  }
  return <Row label={t("stage")} htmlFor={writable ? "deal-stage-select" : undefined}>
    {writable ? <NativeSelect id="deal-stage-select" size="sm" value={stageId} disabled={busy} onChange={(event) => choose(event.target.value)} className="min-w-44 text-sm">
      {stages.map((stage) => <NativeSelectOption key={stage.id} value={stage.id} disabled={stage.archived}>{stage.archived ? t("archivedStage", { stage: stage.name }) : stage.name}</NativeSelectOption>)}
    </NativeSelect> : <p className="min-h-8 px-2 py-1.5 text-sm">{current?.name}</p>}
    <Problem busy={busy} error={error} />
    <Dialog open={!!closing} onOpenChange={(open) => { if (!open) setClosing(null); }}>
      <DialogContent className="rounded-xl sm:max-w-[440px]">
        <DialogHeader><DialogTitle>{closing ? t("closeDealTitle", { stage: stages.find((stage) => stage.id === closing.stageId)?.name ?? "" }) : ""}</DialogTitle><DialogDescription>{t("closeDealDescription")}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (closing) void move(closing.stageId, closing.reason.trim() || null); setClosing(null); }}>
          <Field className="gap-2"><FieldLabel htmlFor="deal-close-reason">{t("closedReason")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel>
            <Textarea id="deal-close-reason" maxLength={500} value={closing?.reason ?? ""} onChange={(event) => setClosing((value) => (value ? { ...value, reason: event.target.value } : value))} className="min-h-20" autoFocus /></Field>
          <DialogFooter><Button type="button" variant="ghost" onClick={() => setClosing(null)}>{t("cancel")}</Button><Button>{t("moveDeal")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </Row>;
}

export function DealAmountField({ value }: { value: string }) {
  const t = useTranslations("Deals");
  const format = useFormatter();
  return <InlineField field="amount" label={t("amountUsd")} value={value} maxLength={15} placeholder={t("amountPlaceholder")}
    display={(text) => format.number(Number(text), { style: "currency", currency: "USD" })} validate={(text) => (text === "" || AMOUNT.test(text) ? null : t("enterAnAmount"))} emptyLabel={t("noAmount")} />;
}
export function DealCloseDateField({ value }: { value: string }) {
  const t = useTranslations("Deals");
  const format = useFormatter();
  return <InlineField field="expectedCloseDate" type="date" label={t("expectedClose")} value={value} maxLength={10}
    display={(text) => format.dateTime(new Date(`${text}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })} emptyLabel={t("noDate")} />;
}
export function DealReasonField({ value }: { value: string }) {
  const t = useTranslations("Deals");
  return <InlineField field="closedReason" label={t("closedReason")} value={value} maxLength={500} multiline emptyLabel={t("noReason")} />;
}

export function DealOwnerControl({ ownerUserId, ownerName, members }: { ownerUserId: string | null; ownerName: string | null; members: { id: string; name: string }[] }) {
  const t = useTranslations("Deals");
  const { save, writable } = useRecord();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function change(value: string) { setBusy(true); setError(""); const failure = await save({ ownerUserId: value }); setBusy(false); if (failure) setError(failure); }
  return <Row label={t("owner")} htmlFor={writable ? "deal-owner-select" : undefined}>
    {writable ? <NativeSelect id="deal-owner-select" size="sm" value={ownerUserId ?? ""} disabled={busy} onChange={(event) => void change(event.target.value)} className="min-w-44 text-sm">
      <NativeSelectOption value="">{t("noOwner")}</NativeSelectOption>
      {members.map((member) => <NativeSelectOption key={member.id} value={member.id}>{member.name}</NativeSelectOption>)}
      {ownerUserId && !members.some((member) => member.id === ownerUserId) && <NativeSelectOption value={ownerUserId}>{t("formerMember")}</NativeSelectOption>}
    </NativeSelect> : <p className="min-h-8 px-2 py-1.5 text-sm">{ownerName ?? (ownerUserId ? t("formerMember") : t("noOwner"))}</p>}
    <Problem busy={busy} error={error} />
  </Row>;
}

/** Company or person link: pick from this workspace (server-searched) or clear it. */
export function DealRelationControl({ kind, tenantId, value, name, otherLinked }: { kind: "company" | "person"; tenantId: string; value: string | null; name: string | null; otherLinked: boolean }) {
  const t = useTranslations("Deals");
  const { save, writable } = useRecord();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const field = kind === "company" ? "companyId" : "contactId";
  async function set(next: string) { setBusy(true); setError(""); const failure = await save({ [field]: next }); setBusy(false); if (failure) setError(failure); return failure; }
  const href = value && name ? `/workspaces/${tenantId}/crm/${kind === "company" ? "companies" : "people"}/${value}` : undefined;
  const label = kind === "company" ? t("company") : t("person");
  return <Row label={label}>
    <div className="flex min-h-8 items-center gap-1">
      {href ? <Link href={href} className="min-w-0 truncate rounded-sm px-2 py-1 text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{name}</Link>
        : <span className="min-w-0 truncate px-2 py-1 text-sm text-muted-foreground">{value ? t("unavailableRecord") : kind === "company" ? t("noCompany") : t("noPerson")}</span>}
      {writable && <span className="ml-auto flex shrink-0 items-center">
        <RecordPicker endpoint={`/api/workspaces/${tenantId}/${kind === "company" ? "companies" : "contacts"}`} toItem={(row) => ({ id: String(row.id), label: String(row.name) })} exclude={value ? [value] : []}
          title={kind === "company" ? t("chooseCompany") : t("choosePerson")} placeholder={kind === "company" ? t("searchCompanies") : t("searchPeople")} emptyLabel={t("noRecordsFound")} align="end"
          trigger={<Button type="button" variant="ghost" size="sm" disabled={busy} className="h-7 text-xs" aria-label={value ? (kind === "company" ? t("changeCompany") : t("changePerson")) : kind === "company" ? t("chooseCompany") : t("choosePerson")}>{value ? t("change") : t("choose")}</Button>}
          onSelect={(item) => set(item.id)} />
        {value && otherLinked && <Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label={kind === "company" ? t("clearCompany") : t("clearPerson")} onClick={() => void set("")}><X aria-hidden="true" /></Button>}
      </span>}
    </div>
    <Problem busy={busy} error={error} />
  </Row>;
}

/** Archive hides the deal from boards and lists; it can be restored from its page. */
export function DealArchiveControl({ archived, board }: { archived: boolean; board: string }) {
  const t = useTranslations("Deals");
  const router = useRouter();
  const { sendTo, writable } = useRecord();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!writable) return null;
  async function toggle(next: boolean) {
    setBusy(true); setError("");
    const failure = await sendTo("", { archived: next });
    setBusy(false);
    if (failure) { setError(failure); return; }
    setOpen(false);
    if (next) router.push(board);
  }
  if (archived) return <div className="space-y-1"><Button variant="outline" size="sm" disabled={busy} onClick={() => void toggle(false)}><RotateCcw aria-hidden="true" />{t("restoreDeal")}</Button>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</div>;
  return <>
    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setError(""); setOpen(true); }}><Archive aria-hidden="true" />{t("archiveDeal")}</Button>
    <AlertDialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <AlertDialogContent className="rounded-xl bg-card"><AlertDialogHeader><AlertDialogTitle>{t("archiveDealTitle")}</AlertDialogTitle><AlertDialogDescription>{t("archiveDealHelp")}</AlertDialogDescription></AlertDialogHeader>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>{t("cancel")}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void toggle(true); }}>{t("archiveDeal")}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
