/** Derived from Shadcn UI Kit item form-layout8 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Giving screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useRequest } from "@/hooks/use-request";
import { centsText, correctionReasons, fundraisingCurrencies, looksLikeAccountNumber, parseCents, type FundraisingRow, type PledgeRow } from "@/lib/fundraising";

type Common = { endpoint: string; trigger?: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void };
const pad = (value: number) => String(value).padStart(2, "0");
// Picked dates are local calendar days, sent as YYYY-MM-DD.
const isoDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromIso = (value: string) => { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); };
const today = () => isoDay(new Date());
const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim() || null;
const NONE = "none";

/**
 * The fundraising forms, laid out as the kit's sectioned order form inside a dialog: create or edit a fundraising campaign, record a pledge, record a
 * confirmed gift and correct a gift. Each submit carries one retry key per open dialog, so a double click or a retried request is the same record.
 * `trigger` opens the dialog itself; `open` and `onOpenChange` let a row menu open it.
 */
function FormDialog({ trigger, open: controlled, onOpenChange, title, description, submitLabel, busyLabel, onSubmit, children, attest }: {
  trigger?: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; title: string; description?: string; submitLabel: string; busyLabel: string; attest?: string;
  onSubmit: (form: FormData, key: string) => Promise<string | null>; children: React.ReactNode;
}) {
  const t = useTranslations("Fundraising"), id = useId(), key = useRef(crypto.randomUUID());
  const [inner, setInner] = useState(false), [isSubmitting, setSubmitting] = useState(false), [error, setError] = useState(""), [agreed, setAgreed] = useState(false);
  const open = controlled ?? inner;
  const setOpen = (value: boolean) => { setInner(value); onOpenChange?.(value); };
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true); setError("");
    const failed = await onSubmit(form, key.current);
    setSubmitting(false);
    if (failed) { setError(failed); return; }
    key.current = crypto.randomUUID(); setAgreed(false); setOpen(false);
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!isSubmitting) { setOpen(value); setError(""); } }}>
    {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader className="border-b pb-4">
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <form id={id} noValidate onSubmit={(event) => void submit(event)} className="contents">
        <FieldGroup>
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          {children}
          {attest && (
            <Field orientation="horizontal" className="min-h-11">
              <Checkbox
                id={`${id}-attest`}
                checked={agreed}
                onCheckedChange={(checked) => setAgreed(checked === true)}
              />
              <FieldLabel htmlFor={`${id}-attest`} className="font-normal">
                {attest}
              </FieldLabel>
            </Field>
          )}
        </FieldGroup>
      </form>
      <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-full sm:w-auto lg:min-h-9"
            disabled={isSubmitting}
          >
            {t("cancel")}
          </Button>
        </DialogClose>
        <Button
          type="submit"
          form={id}
          className="min-h-11 w-full sm:w-auto lg:min-h-9"
          disabled={isSubmitting || (attest !== undefined && !agreed)}
        >
          {isSubmitting && <Spinner />}
          {isSubmitting ? busyLabel : submitLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function AmountField({ name, label, currency, defaultValue, required = true }: { name: string; label: string; currency?: string; defaultValue?: string; required?: boolean }) {
  const t = useTranslations("Fundraising"), id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup className="min-h-11 lg:min-h-9">
        {currency && (
        <InputGroupAddon>
          <InputGroupText>
            {currency}
          </InputGroupText>
        </InputGroupAddon>
        )}
        <InputGroupInput
          id={id}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          required={required}
          defaultValue={defaultValue}
          placeholder={t("amountPlaceholder")}
          className="tabular-nums"
        />
      </InputGroup>
    </Field>
  );
}

function TextField({ name, label, max, defaultValue, hint, placeholder, required, optional }: {
  name: string; label: string; max?: number; defaultValue?: string | null; hint?: string; placeholder?: string; required?: boolean; optional?: boolean;
}) {
  const t = useTranslations("Fundraising"), id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label}
        {optional && <>{" "}
        <span className="text-muted-foreground font-normal">
          {t("optional")}
        </span></>}
      </FieldLabel>
      <Input
        id={id}
        name={name}
        maxLength={max}
        defaultValue={defaultValue ?? undefined}
        placeholder={placeholder}
        required={required}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="min-h-11 lg:min-h-9"
      />
      {hint && <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>}
    </Field>
  );
}

/** The kit's popover date picker; the chosen local day is submitted as YYYY-MM-DD under `name`. */
function DateField({ name, label, defaultValue, optional }: { name: string; label: string; defaultValue?: string; optional?: boolean }) {
  const t = useTranslations("Fundraising"), format = useFormatter(), id = useId();
  const [value, setValue] = useState<Date | undefined>(defaultValue ? fromIso(defaultValue) : undefined);
  const [dateOpen, setDateOpen] = useState(false);
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label}
        {optional && <>{" "}
        <span className="text-muted-foreground font-normal">
          {t("optional")}
        </span></>}
      </FieldLabel>
      <input type="hidden" name={name} value={value ? isoDay(value) : ""} />
      <Popover
        open={dateOpen}
        onOpenChange={setDateOpen}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              "min-h-11 w-full justify-between font-normal lg:min-h-9",
              !value && "text-muted-foreground",
            )}
          >
            {value
              ? format.dateTime(value, { dateStyle: "medium" })
              : t("pickDate")}
            <CalendarIcon className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            defaultMonth={value ?? new Date()}
            onSelect={(date) => {
              setValue(date);
              setDateOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </Field>
  );
}

function OptionField({ name, label, defaultValue, options }: { name: string; label: string; defaultValue: string; options: { value: string; label: string }[] }) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input type="hidden" name={name} value={value === NONE ? "" : value} />
      <Select
        value={value}
        onValueChange={setValue}
      >
        <SelectTrigger id={id} className="min-h-11 w-full lg:min-h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((item) => (
            <SelectItem key={item.value} value={item.value} className="max-lg:min-h-11">
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Create (no `row`) or edit a fundraising campaign. Creating may link an outreach campaign, whose budget settings fill an empty goal. */
export function FundraisingFormDialog({ endpoint, trigger, row, campaigns, onSaved }: Common & {
  row?: FundraisingRow; campaigns?: { id: string; name: string }[]; onSaved: (row: FundraisingRow) => void;
}) {
  const t = useTranslations("Fundraising"), request = useRequest(), id = useId();
  const [currency, setCurrency] = useState<string>(row?.currency ?? "USD");
  const [note, setNote] = useState(row?.summary ?? "");
  const fromBudget = !row && Boolean(campaigns?.length);
  return <FormDialog trigger={trigger} title={t(row ? "editTitle" : "new")} submitLabel={t(row ? "save" : "create")} busyLabel={t(row ? "saving" : "creating")}
    onSubmit={async (form, key) => {
      const goalText = String(form.get("goal") ?? "").trim(), goalCents = goalText ? parseCents(goalText) : null;
      if (goalText && !goalCents) return t("invalidAmount");
      const body = row
        ? { version: row.version, title: text(form, "title"), summary: text(form, "summary"), ...(goalCents ? { goalCents } : {}), currency }
        : { title: text(form, "title"), summary: text(form, "summary"), campaignId: text(form, "campaignId"), goalCents, currency: goalCents ? currency : null };
      const result = await request<FundraisingRow>(row ? `${endpoint}/${row.id}` : endpoint, { method: row ? "PATCH" : "POST", body, headers: row ? undefined : { "Idempotency-Key": key } });
      if (!result.ok) return result.error;
      onSaved(result.data); return null;
    }}>
    <FieldSet>
      <FieldLegend>{t("sections.details")}</FieldLegend>
      <FieldGroup className="grid sm:grid-cols-2">
        <TextField name="title" label={t("fields.title")} max={200} defaultValue={row?.title} required />
        {!row && campaigns && <OptionField name="campaignId" label={t("fields.campaign")} defaultValue={NONE}
          options={[{ value: NONE, label: t("fields.noCampaign") }, ...campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name }))]} />}
        <Field className="sm:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor={`${id}-summary`}>{t("fields.summary")}</FieldLabel>
            <span
              className={cn(
                "text-muted-foreground text-xs tabular-nums",
                note.length > 2000 && "text-destructive",
              )}
            >
              {t("characterCount", { count: note.length, max: 2000 })}
            </span>
          </div>
          <Textarea
            id={`${id}-summary`}
            name="summary"
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </FieldGroup>
    </FieldSet>

    <FieldSeparator />

    <FieldSet>
      <FieldLegend>{t("sections.goal")}</FieldLegend>
      <FieldGroup className="grid sm:grid-cols-[160px_1fr]">
        <Field>
          <FieldLabel htmlFor={`${id}-currency`}>{t("fields.currency")}</FieldLabel>
          <Select
            value={currency}
            onValueChange={setCurrency}
          >
            <SelectTrigger id={`${id}-currency`} className="min-h-11 w-full lg:min-h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fundraisingCurrencies.map(
                (code) => (
                  <SelectItem key={code} value={code} className="max-lg:min-h-11">
                    {code}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor={`${id}-goal`}>{t("fields.goal")}</FieldLabel>
          <InputGroup className="min-h-11 lg:min-h-9">
            <InputGroupAddon>
              <InputGroupText>
                {currency}
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id={`${id}-goal`}
              name="goal"
              inputMode="decimal"
              autoComplete="off"
              placeholder={t("amountPlaceholder")}
              required={!fromBudget}
              defaultValue={row ? centsText(row.goalCents) : undefined}
              aria-describedby={fromBudget ? `${id}-goal-hint` : undefined}
              className="tabular-nums"
            />
          </InputGroup>
          {fromBudget && <FieldDescription id={`${id}-goal-hint`}>{t("fields.goalFromBudget")}</FieldDescription>}
        </Field>
      </FieldGroup>
    </FieldSet>
  </FormDialog>;
}

/** A pledge recorded by staff. An intention only; it never counts as raised. */
export function PledgeDialog({ endpoint, trigger, currency, onSaved }: Common & { currency: string; onSaved: () => void }) {
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
    <FieldSet>
      <FieldLegend>{t("sections.pledge")}</FieldLegend>
      <FieldGroup className="grid sm:grid-cols-2">
        <AmountField name="amount" label={t("fields.amount")} currency={currency} />
        <DateField name="expectedOn" label={t("fields.expectedOn")} optional />
      </FieldGroup>
    </FieldSet>

    <FieldSeparator />

    <FieldSet>
      <FieldLegend>{t("sections.supporter")}</FieldLegend>
      <FieldGroup className="grid sm:grid-cols-2">
        <TextField name="supporterName" label={t("fields.supporterName")} max={120} optional />
        <TextField name="supporterContact" label={t("fields.supporterContact")} max={200} hint={t("pledgePrivacy")} optional />
      </FieldGroup>
    </FieldSet>
  </FormDialog>;
}

/** A gift the ministry confirmed outside Harvest: amount, date, optional pledge or supporter, method as free text. Requires the confirmation statement. */
export function GiftDialog({ endpoint, trigger, currency, pledges, onSaved }: Common & { currency: string; pledges: PledgeRow[]; onSaved: () => void }) {
  const t = useTranslations("Fundraising"), request = useRequest();
  const open = pledges.filter((pledge) => pledge.status !== "cancelled");
  return <FormDialog trigger={trigger} title={t("recordGiftTitle")} description={t("recordGiftDescription")} submitLabel={t("recordGift")} busyLabel={t("saving")} attest={t("attest")}
    onSubmit={async (form, key) => {
      const amountCents = parseCents(String(form.get("amount") ?? ""));
      if (!amountCents) return t("invalidAmount");
      if (!text(form, "giftDate")) return t("dateRequired");
      if (looksLikeAccountNumber(text(form, "methodLabel")) || looksLikeAccountNumber(text(form, "reference"))) return t("accountNumber");
      const pledgeId = text(form, "pledgeId");
      const result = await request(`${endpoint}/gifts`, { method: "POST", headers: { "Idempotency-Key": key }, body: { amountCents, giftDate: text(form, "giftDate"), pledgeId,
        supporterName: pledgeId ? null : text(form, "supporterName"), methodLabel: text(form, "methodLabel"), reference: text(form, "reference"), confirmed: true } });
      if (!result.ok) return result.error;
      onSaved(); return null;
    }}>
    <FieldSet>
      <FieldLegend>{t("sections.gift")}</FieldLegend>
      <FieldGroup className="grid sm:grid-cols-2">
        <AmountField name="amount" label={t("fields.amount")} currency={currency} />
        <DateField name="giftDate" label={t("fields.giftDate")} defaultValue={today()} />
        {open.length > 0 && <OptionField name="pledgeId" label={t("fields.pledge")} defaultValue={NONE}
          options={[{ value: NONE, label: t("fields.noPledge") }, ...open.map((pledge) => ({ value: pledge.id, label: t("pledgeOption", { name: pledge.supporterName ?? t("anonymous"), amount: `${centsText(pledge.amountCents)} ${pledge.currency}` }) }))]} />}
        <TextField name="supporterName" label={t("fields.supporterName")} max={120} optional />
      </FieldGroup>
    </FieldSet>

    <FieldSeparator />

    <FieldSet>
      <FieldLegend>{t("sections.method")}</FieldLegend>
      <FieldGroup className="grid sm:grid-cols-2">
        <TextField name="methodLabel" label={t("fields.method")} max={80} placeholder={t("fields.methodPlaceholder")} optional />
        <TextField name="reference" label={t("fields.reference")} max={120} hint={t("fields.referenceHint")} optional />
      </FieldGroup>
    </FieldSet>
  </FormDialog>;
}

/** Reverses a gift and, with a correct amount, records it again. The original stays in the history. */
export function CorrectGiftDialog({ endpoint, entryId, trigger, open, onOpenChange, currency, onSaved }: Common & { entryId: string; currency: string; onSaved: () => void }) {
  const t = useTranslations("Fundraising"), request = useRequest();
  return <FormDialog trigger={trigger} open={open} onOpenChange={onOpenChange} title={t("correctTitle")} description={t("correctDescription")} submitLabel={t("correctSubmit")} busyLabel={t("saving")} attest={t("correctAttest")}
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
    <FieldSet>
      <FieldLegend>{t("sections.correction")}</FieldLegend>
      <FieldGroup className="grid sm:grid-cols-2">
        <div className="sm:col-span-2">
          <OptionField name="reason" label={t("fields.reason")} defaultValue="entered_in_error"
            options={correctionReasons.map((reason) => ({ value: reason, label: t(`reasons.${reason}`) }))} />
        </div>
        <AmountField name="replacement" label={t("fields.replacement")} currency={currency} required={false} />
        <DateField name="replacementDate" label={t("fields.replacementDate")} defaultValue={today()} />
      </FieldGroup>
    </FieldSet>
  </FormDialog>;
}

/** Router refresh helper shared by the dialogs' callers. */
export function useRefresh() { const router = useRouter(); return () => router.refresh(); }
