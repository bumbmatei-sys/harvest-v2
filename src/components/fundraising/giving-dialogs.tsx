"use client";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useRequest } from "@/hooks/use-request";
import { centsText, correctionReasons, fundraisingCurrencies, looksLikeAccountNumber, parseCents, type FundraisingRow, type PledgeRow } from "@/lib/fundraising";

type Common = { endpoint: string; trigger: React.ReactNode };
const today = () => new Date().toISOString().slice(0, 10);
const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim() || null;

/**
 * The fundraising forms, all on the shared Dialog + Field primitives (no new kit item): create or edit a fundraising campaign, record a pledge,
 * record a confirmed gift and correct a gift. Each submit carries one retry key per open dialog, so a double click or a retried request is the same record.
 */
function FormDialog({ trigger, title, description, submitLabel, busyLabel, onSubmit, children, attest }: {
  trigger: React.ReactNode; title: string; description?: string; submitLabel: string; busyLabel: string; attest?: string;
  onSubmit: (form: FormData, key: string) => Promise<string | null>; children: React.ReactNode;
}) {
  const t = useTranslations("Fundraising"), id = useId(), key = useRef(crypto.randomUUID());
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [agreed, setAgreed] = useState(false);
  async function submit(form: FormData) {
    setBusy(true); setError("");
    const failed = await onSubmit(form, key.current);
    setBusy(false);
    if (failed) { setError(failed); return; }
    key.current = crypto.randomUUID(); setAgreed(false); setOpen(false);
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) { setOpen(value); setError(""); } }}>
    <DialogTrigger asChild>{trigger}</DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[520px]">
      <DialogHeader><DialogTitle>{title}</DialogTitle>{description && <DialogDescription>{description}</DialogDescription>}</DialogHeader>
      <form id={id} action={(form) => void submit(form)}>
        <FieldGroup>
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          {children}
          {attest && <label htmlFor={`${id}-attest`} className="flex min-h-11 items-start gap-3 text-sm">
            <Checkbox id={`${id}-attest`} checked={agreed} onCheckedChange={(value) => setAgreed(value === true)} className="mt-0.5 size-5" />{attest}</label>}
        </FieldGroup>
      </form>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="ghost" className="min-h-11" disabled={busy}>{t("cancel")}</Button></DialogClose>
        <Button type="submit" form={id} className="min-h-11" disabled={busy || (attest !== undefined && !agreed)}>{busy ? busyLabel : submitLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function AmountField({ name, label, defaultValue, required = true }: { name: string; label: string; defaultValue?: string; required?: boolean }) {
  const t = useTranslations("Fundraising"), id = useId();
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input id={id} name={name} inputMode="decimal" autoComplete="off" required={required} defaultValue={defaultValue} placeholder={t("amountPlaceholder")} className="min-h-11 tabular-nums" /></Field>;
}
function TextField({ name, label, max, type = "text", defaultValue, hint, placeholder, required }: {
  name: string; label: string; max?: number; type?: string; defaultValue?: string | null; hint?: string; placeholder?: string; required?: boolean;
}) {
  const id = useId();
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input id={id} name={name} type={type} maxLength={max} defaultValue={defaultValue ?? undefined} placeholder={placeholder} required={required}
      aria-describedby={hint ? `${id}-hint` : undefined} className="min-h-11" />
    {hint && <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>}</Field>;
}

/** Create (no `row`) or edit a fundraising campaign. Creating may link an outreach campaign, whose budget settings fill an empty goal. */
export function FundraisingFormDialog({ endpoint, trigger, row, campaigns, onSaved }: Common & {
  row?: FundraisingRow; campaigns?: { id: string; name: string }[]; onSaved: (row: FundraisingRow) => void;
}) {
  const t = useTranslations("Fundraising"), request = useRequest(), id = useId();
  return <FormDialog trigger={trigger} title={t(row ? "editTitle" : "new")} submitLabel={t(row ? "save" : "create")} busyLabel={t(row ? "saving" : "creating")}
    onSubmit={async (form, key) => {
      const goalText = String(form.get("goal") ?? "").trim(), goalCents = goalText ? parseCents(goalText) : null;
      if (goalText && !goalCents) return t("invalidAmount");
      const body = row
        ? { version: row.version, title: text(form, "title"), summary: text(form, "summary"), ...(goalCents ? { goalCents } : {}), currency: form.get("currency") }
        : { title: text(form, "title"), summary: text(form, "summary"), campaignId: text(form, "campaignId"), goalCents, currency: goalCents ? form.get("currency") : null };
      const result = await request<FundraisingRow>(row ? `${endpoint}/${row.id}` : endpoint, { method: row ? "PATCH" : "POST", body, headers: row ? undefined : { "Idempotency-Key": key } });
      if (!result.ok) return result.error;
      onSaved(result.data); return null;
    }}>
    <TextField name="title" label={t("fields.title")} max={200} defaultValue={row?.title} required />
    <Field><FieldLabel htmlFor={`${id}-summary`}>{t("fields.summary")}</FieldLabel>
      <Textarea id={`${id}-summary`} name="summary" maxLength={2000} rows={3} defaultValue={row?.summary ?? undefined} /></Field>
    {!row && campaigns && <Field><FieldLabel htmlFor={`${id}-campaign`}>{t("fields.campaign")}</FieldLabel>
      <NativeSelect id={`${id}-campaign`} name="campaignId" defaultValue="" className="min-h-11">
        <NativeSelectOption value="">{t("fields.noCampaign")}</NativeSelectOption>
        {campaigns.map((campaign) => <NativeSelectOption key={campaign.id} value={campaign.id}>{campaign.name}</NativeSelectOption>)}
      </NativeSelect></Field>}
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
      <Field><FieldLabel htmlFor={`${id}-goal`}>{t("fields.goal")}</FieldLabel>
        <Input id={`${id}-goal`} name="goal" inputMode="decimal" autoComplete="off" required={Boolean(row) || !campaigns?.length} defaultValue={row ? centsText(row.goalCents) : undefined}
          placeholder={t("amountPlaceholder")} aria-describedby={!row && campaigns?.length ? `${id}-goal-hint` : undefined} className="min-h-11 tabular-nums" />
        {!row && campaigns?.length ? <FieldDescription id={`${id}-goal-hint`}>{t("fields.goalFromBudget")}</FieldDescription> : null}</Field>
      <Field><FieldLabel htmlFor={`${id}-currency`}>{t("fields.currency")}</FieldLabel>
        <NativeSelect id={`${id}-currency`} name="currency" defaultValue={row?.currency ?? "USD"} className="min-h-11">
          {fundraisingCurrencies.map((code) => <NativeSelectOption key={code} value={code}>{code}</NativeSelectOption>)}
        </NativeSelect></Field>
    </div>
  </FormDialog>;
}

/** A pledge recorded by staff. An intention only; it never counts as raised. */
export function PledgeDialog({ endpoint, trigger, onSaved }: Common & { onSaved: () => void }) {
  const t = useTranslations("Fundraising"), request = useRequest();
  return <FormDialog trigger={trigger} title={t("recordPledgeTitle")} description={t("recordPledgeDescription")} submitLabel={t("recordPledge")} busyLabel={t("saving")}
    onSubmit={async (form, key) => {
      const amountCents = parseCents(String(form.get("amount") ?? ""));
      if (!amountCents) return t("invalidAmount");
      const result = await request(`${endpoint}/pledges`, { method: "POST", headers: { "Idempotency-Key": key },
        body: { amountCents, supporterName: text(form, "supporterName"), supporterContact: text(form, "supporterContact"), expectedOn: text(form, "expectedOn") } });
      if (!result.ok) return result.error;
      onSaved(); return null;
    }}>
    <AmountField name="amount" label={t("fields.amount")} />
    <TextField name="supporterName" label={t("fields.supporterName")} max={120} />
    <TextField name="supporterContact" label={t("fields.supporterContact")} max={200} hint={t("pledgePrivacy")} />
    <TextField name="expectedOn" type="date" label={t("fields.expectedOn")} />
  </FormDialog>;
}

/** A gift the ministry confirmed outside Harvest: amount, date, optional pledge or supporter, method as free text. Requires the confirmation statement. */
export function GiftDialog({ endpoint, trigger, pledges, onSaved }: Common & { pledges: PledgeRow[]; onSaved: () => void }) {
  const t = useTranslations("Fundraising"), request = useRequest(), id = useId();
  const open = pledges.filter((pledge) => pledge.status !== "cancelled");
  return <FormDialog trigger={trigger} title={t("recordGiftTitle")} description={t("recordGiftDescription")} submitLabel={t("recordGift")} busyLabel={t("saving")} attest={t("attest")}
    onSubmit={async (form, key) => {
      const amountCents = parseCents(String(form.get("amount") ?? ""));
      if (!amountCents) return t("invalidAmount");
      if (looksLikeAccountNumber(text(form, "methodLabel")) || looksLikeAccountNumber(text(form, "reference"))) return t("accountNumber");
      const pledgeId = text(form, "pledgeId");
      const result = await request(`${endpoint}/gifts`, { method: "POST", headers: { "Idempotency-Key": key }, body: { amountCents, giftDate: text(form, "giftDate"), pledgeId,
        supporterName: pledgeId ? null : text(form, "supporterName"), methodLabel: text(form, "methodLabel"), reference: text(form, "reference"), confirmed: true } });
      if (!result.ok) return result.error;
      onSaved(); return null;
    }}>
    <AmountField name="amount" label={t("fields.amount")} />
    <TextField name="giftDate" type="date" label={t("fields.giftDate")} defaultValue={today()} required />
    {open.length > 0 && <Field><FieldLabel htmlFor={`${id}-pledge`}>{t("fields.pledge")}</FieldLabel>
      <NativeSelect id={`${id}-pledge`} name="pledgeId" defaultValue="" className="min-h-11">
        <NativeSelectOption value="">{t("fields.noPledge")}</NativeSelectOption>
        {open.map((pledge) => <NativeSelectOption key={pledge.id} value={pledge.id}>{t("pledgeOption", { name: pledge.supporterName ?? t("anonymous"), amount: `${centsText(pledge.amountCents)} ${pledge.currency}` })}</NativeSelectOption>)}
      </NativeSelect></Field>}
    <TextField name="supporterName" label={t("fields.supporterName")} max={120} />
    <TextField name="methodLabel" label={t("fields.method")} max={80} placeholder={t("fields.methodPlaceholder")} />
    <TextField name="reference" label={t("fields.reference")} max={120} hint={t("fields.referenceHint")} />
  </FormDialog>;
}

/** Reverses a gift and, with a correct amount, records it again. The original stays in the history. */
export function CorrectGiftDialog({ endpoint, entryId, trigger, onSaved }: Common & { entryId: string; onSaved: () => void }) {
  const t = useTranslations("Fundraising"), request = useRequest(), id = useId();
  return <FormDialog trigger={trigger} title={t("correctTitle")} description={t("correctDescription")} submitLabel={t("correctSubmit")} busyLabel={t("saving")} attest={t("correctAttest")}
    onSubmit={async (form, key) => {
      const replacementText = String(form.get("replacement") ?? "").trim(), replacementCents = replacementText ? parseCents(replacementText) : null;
      if (replacementText && !replacementCents) return t("invalidAmount");
      const replacementDate = text(form, "replacementDate");
      if (replacementCents && !replacementDate) return t("dateRequired");
      const result = await request(`${endpoint}/gifts/${entryId}`, { method: "POST", headers: { "Idempotency-Key": key },
        body: { reason: form.get("reason"), replacementCents, replacementDate: replacementCents ? replacementDate : null, confirmed: true } });
      if (!result.ok) return result.error;
      onSaved(); return null;
    }}>
    <Field><FieldLabel htmlFor={`${id}-reason`}>{t("fields.reason")}</FieldLabel>
      <NativeSelect id={`${id}-reason`} name="reason" defaultValue="entered_in_error" className="min-h-11">
        {correctionReasons.map((reason) => <NativeSelectOption key={reason} value={reason}>{t(`reasons.${reason}`)}</NativeSelectOption>)}
      </NativeSelect></Field>
    <AmountField name="replacement" label={t("fields.replacement")} required={false} />
    <TextField name="replacementDate" type="date" label={t("fields.replacementDate")} defaultValue={today()} />
  </FormDialog>;
}

/** Router refresh helper shared by the dialogs' callers. */
export function useRefresh() { const router = useRouter(); return () => router.refresh(); }
