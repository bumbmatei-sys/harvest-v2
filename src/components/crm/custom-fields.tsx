"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { FieldDefinition, FieldValue, ObjectType } from "@/lib/crm-fields";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InlineField } from "./inline-field";
import { useRecord } from "./record-context";
import { RecordPicker } from "./record-picker";

export type CustomFieldMeta = Pick<FieldDefinition, "key" | "label" | "description" | "type" | "required" | "options" | "relationTarget">;

/** Label column shared with InlineField so built-in and custom rows align. */
function Row({ label, description, required, htmlFor, children }: { label: string; description: string; required: boolean; htmlFor?: string; children: React.ReactNode }) {
  const t = useTranslations("Crm");
  return <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-x-3 py-0.5 sm:grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)]">
    <label htmlFor={htmlFor} title={description || undefined} className="flex min-h-8 items-center gap-2 text-xs text-muted-foreground"><span className="truncate">{label}</span>{required && <span aria-hidden="true" className="text-destructive">{t("requiredMark")}</span>}</label>
    <div className="min-w-0">{children}</div>
  </div>;
}

function Feedback({ busy, error }: { busy: boolean; error: string }) {
  const t = useTranslations("Crm");
  return <>{busy && <p role="status" className="px-2 text-xs text-muted-foreground">{t("saving")}</p>}{error && <p role="alert" className="px-2 text-xs text-destructive">{error}</p>}</>;
}

/** Boolean and single-select values: one native select that saves on change. */
function ChoiceField({ field, value }: { field: CustomFieldMeta; value: string }) {
  const t = useTranslations("Crm");
  const { saveCustom, writable } = useRecord();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [shown, setShown] = useState(value), [base, setBase] = useState(value);
  if (value !== base) { setBase(value); setShown(value); }
  const options = field.type === "boolean" ? [{ value: "true", label: t("yes") }, { value: "false", label: t("no") }] : field.options;
  const id = `custom-${field.key}`;
  async function change(next: string) {
    if (field.required && !next) { setError(t("thisFieldIsRequired")); return; }
    const previous = shown;
    setShown(next); setBusy(true); setError("");
    const failure = await saveCustom({ [field.key]: next === "" ? null : field.type === "boolean" ? next === "true" : next });
    setBusy(false);
    if (failure) { setShown(previous); setError(failure); }
  }
  const label = options.find((option) => option.value === shown)?.label;
  return <Row label={field.label} description={field.description} required={field.required} htmlFor={writable ? id : undefined}>
    {writable ? <NativeSelect id={id} value={shown} disabled={busy} onChange={(event) => void change(event.target.value)} className="h-8 w-full text-sm" aria-invalid={!!error}>
      <NativeSelectOption value="">{t("empty")}</NativeSelectOption>
      {options.map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}
    </NativeSelect> : <p className={cn("min-h-8 truncate px-2 py-1.5 text-sm", !label && "text-muted-foreground")}>{label ?? t("empty")}</p>}
    <Feedback busy={busy} error={error} />
  </Row>;
}

/** Multi-select: a popover of checkboxes; every toggle saves. */
function MultiField({ field, value }: { field: CustomFieldMeta; value: string[] }) {
  const t = useTranslations("Crm");
  const { saveCustom, writable } = useRecord();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [shown, setShown] = useState(value), [base, setBase] = useState(value);
  if (value.join(",") !== base.join(",")) { setBase(value); setShown(value); }
  async function toggle(option: string, checked: boolean) {
    const next = field.options.map((item) => item.value).filter((item) => (item === option ? checked : shown.includes(item)));
    if (field.required && !next.length) { setError(t("thisFieldIsRequired")); return; }
    const previous = shown;
    setShown(next); setBusy(true); setError("");
    const failure = await saveCustom({ [field.key]: next.length ? next : null });
    setBusy(false);
    if (failure) { setShown(previous); setError(failure); }
  }
  const text = shown.map((item) => field.options.find((option) => option.value === item)?.label ?? item).join(", ");
  return <Row label={field.label} description={field.description} required={field.required}>
    {writable ? <Popover>
      <PopoverTrigger asChild><Button variant="ghost" size="sm" className={cn("h-auto min-h-8 w-full justify-between px-2 py-1.5 text-left text-sm font-normal", !text && "text-muted-foreground")} aria-label={t("editFieldValue", { field: field.label, value: text || t("empty") })}>
        <span className="min-w-0 truncate">{text || t("empty")}</span><ChevronDown aria-hidden="true" className="text-muted-foreground" /></Button></PopoverTrigger>
      <PopoverContent align="start" className="w-[min(18rem,calc(100vw-2rem))] p-2">
        <fieldset><legend className="sr-only">{field.label}</legend><div className="max-h-64 space-y-0.5 overflow-y-auto">
          {field.options.map((option) => <Label key={option.value} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm font-normal hover:bg-muted">
            <Checkbox checked={shown.includes(option.value)} disabled={busy} onCheckedChange={(checked) => void toggle(option.value, checked === true)} />{option.label}</Label>)}
        </div></fieldset>
      </PopoverContent>
    </Popover> : <p className={cn("min-h-8 truncate px-2 py-1.5 text-sm", !text && "text-muted-foreground")}>{text || t("empty")}</p>}
    <Feedback busy={busy} error={error} />
  </Row>;
}

/** Relation: pick a person or company from this workspace (server-searched), or clear it. */
function RelationField({ field, value, name, tenantId }: { field: CustomFieldMeta; value: string | null; name: string | null; tenantId: string }) {
  const t = useTranslations("Crm");
  const { saveCustom, writable } = useRecord();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const target: ObjectType = field.relationTarget ?? "person";
  const href = value && name ? `/workspaces/${tenantId}/crm/${target === "company" ? "companies" : "people"}/${value}` : undefined;
  async function set(next: string | null) {
    if (field.required && !next) { setError(t("thisFieldIsRequired")); return null; }
    setBusy(true); setError("");
    const failure = await saveCustom({ [field.key]: next });
    setBusy(false);
    if (failure) setError(failure);
    return failure;
  }
  const text = value ? name ?? t("unavailableRecord") : t("empty");
  return <Row label={field.label} description={field.description} required={field.required}>
    <div className="flex min-h-8 items-center gap-1">
      {href ? <Link href={href} className="min-w-0 truncate rounded-sm px-2 py-1 text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{text}</Link>
        : <span className={cn("min-w-0 truncate px-2 py-1 text-sm", !value || !name ? "text-muted-foreground" : "")}>{text}</span>}
      {writable && <span className="ml-auto flex shrink-0 items-center">
        <RecordPicker endpoint={`/api/workspaces/${tenantId}/${target === "company" ? "companies" : "contacts"}`} toItem={(row) => ({ id: String(row.id), label: String(row.name) })} exclude={value ? [value] : []}
          title={t("chooseRecordFor", { field: field.label })} placeholder={t("searchRecords")} emptyLabel={t("noRecordsFound")} align="end"
          trigger={<Button type="button" variant="ghost" size="sm" disabled={busy} className="h-7 text-xs">{value ? t("change") : t("choose")}</Button>}
          onSelect={(item) => set(item.id)} />
        {value && <Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label={t("clearField", { field: field.label })} onClick={() => void set(null)}><X aria-hidden="true" /></Button>}
      </span>}
    </div>
    <Feedback busy={busy} error={error} />
  </Row>;
}

/** The record page's Custom fields section, in definition order. Viewers see values read-only. */
export function CustomFields({ fields, values, related, tenantId, manageHref }: {
  fields: CustomFieldMeta[]; values: Record<string, FieldValue>; related: Record<string, string>; tenantId: string; manageHref: string | null;
}) {
  const t = useTranslations("Crm");
  const format = useFormatter();
  const { saveCustom } = useRecord();
  if (!fields.length) return <p className="text-xs text-muted-foreground">{t("noCustomFieldsYet")}{manageHref && <> <Link href={manageHref} className="underline underline-offset-4 hover:text-foreground">{t("manageFields")}</Link></>}</p>;
  return <div className="space-y-0.5">
    {fields.map((field) => {
      const value = values[field.key] ?? null;
      if (field.type === "boolean" || field.type === "select") return <ChoiceField key={field.key} field={field} value={value === null ? "" : String(value)} />;
      if (field.type === "multi_select") return <MultiField key={field.key} field={field} value={Array.isArray(value) ? value : []} />;
      if (field.type === "relation") return <RelationField key={field.key} field={field} value={typeof value === "string" ? value : null} name={typeof value === "string" ? related[value] ?? null : null} tenantId={tenantId} />;
      const raw = value === null ? "" : String(value);
      return <InlineField key={field.key} field={`cf:${field.key}`} label={field.label} description={field.description} value={raw} required={field.required}
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} maxLength={field.type === "text" ? 500 : 40}
        display={field.type === "number" ? (text) => format.number(Number(text)) : field.type === "date" ? (text) => format.dateTime(new Date(`${text}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }) : undefined}
        validate={field.type === "number" ? (text) => (text === "" || Number.isFinite(Number(text)) ? null : t("checkThisValue")) : undefined}
        onSave={(text) => saveCustom({ [field.key]: text === "" ? null : field.type === "number" ? Number(text) : text })} />;
    })}
    {manageHref && <p className="pt-2 text-xs"><Link href={manageHref} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{t("manageFields")}</Link></p>}
  </div>;
}
