"use client";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { ArrowLeft, ListFilter } from "lucide-react";
import { operandsByType, valuelessOperands, validateFilter, type FieldType, type Filter, type FilterField, type Operand } from "@/lib/crm-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCrmRequest } from "./request";

/** A filterable field with its display label and, for choices, labelled options. */
export type FieldMeta = FilterField & { label: string };

function RelationSearch({ endpoint, value, onChange }: { endpoint: string; value: string; onChange: (id: string, name: string) => void }) {
  const t = useTranslations("Crm");
  const crmRequest = useCrmRequest();
  const [items, setItems] = useState<{ id: string; name: string }[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), ticket = useRef(0);
  function search(query: string) {
    const current = ++ticket.current; clearTimeout(timer.current); setLoading(true); setError("");
    timer.current = setTimeout(async () => {
      const result = await crmRequest<{ rows: { id: string; name: string }[] }>(`${endpoint}?${new URLSearchParams(query.trim() ? { q: query.trim() } : {})}`, { method: "GET" });
      if (current !== ticket.current) return;
      setLoading(false);
      if (!result.ok) { setError(result.error); return; }
      setItems(result.data.rows.map((row) => ({ id: row.id, name: row.name })));
    }, query ? 200 : 0);
  }
  return <Command shouldFilter={false} className="rounded-md border">
    <CommandInput placeholder={t("searchRecords")} onValueChange={search} onFocus={() => { if (!items.length) search(""); }} />
    <CommandList className="max-h-48" aria-busy={loading}>
      {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
      <CommandEmpty>{loading ? t("searching") : t("noRecordsFound")}</CommandEmpty>
      <CommandGroup>{items.map((item) => <CommandItem key={item.id} value={item.id} data-checked={item.id === value} onSelect={() => onChange(item.id, item.name)}>{item.name}</CommandItem>)}</CommandGroup>
    </CommandList>
  </Command>;
}

/** Two steps, as in Twenty's view bar: pick a field, then an operand and value fit for its type. */
export function FilterBuilder({ fields, tenantId, onApply, activeCount }: { fields: FieldMeta[]; tenantId: string; onApply: (filter: Filter, relatedName?: string) => void; activeCount: number }) {
  const t = useTranslations("Crm");
  const [open, setOpen] = useState(false), [field, setField] = useState<FieldMeta | null>(null);
  const [op, setOp] = useState<Operand>("contains"), [text, setText] = useState(""), [choices, setChoices] = useState<string[]>([]), [relatedName, setRelatedName] = useState(""), [error, setError] = useState("");
  function pick(next: FieldMeta) { setField(next); setOp(operandsByType[next.type][0]); setText(""); setChoices([]); setRelatedName(""); setError(""); }
  function reset(value: boolean) { setOpen(value); if (!value) { setField(null); setError(""); } }
  function apply() {
    if (!field) return;
    const value = valuelessOperands.includes(op) ? null : field.type === "select" || field.type === "multi_select" ? choices.join(",") : text;
    const filter = validateFilter({ field: field.key, op, value }, [field]);
    if (!filter) { setError(t("completeTheFilter")); return; }
    onApply(filter, relatedName || undefined);
    reset(false);
  }
  const inputType: Partial<Record<FieldType, string>> = { number: "number", date: "date" };
  return <Popover open={open} onOpenChange={reset}>
    <PopoverTrigger asChild><Button variant="outline" size="responsive"><ListFilter aria-hidden="true" />{t("filter")}{activeCount > 0 && <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 rounded-full px-1.5 tabular-nums">{activeCount}</Badge>}</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
      {!field ? <Command label={t("filterBy")}>
        <CommandInput placeholder={t("searchFields")} />
        <CommandList className="max-h-72"><CommandEmpty>{t("noFieldsFound")}</CommandEmpty>
          <CommandGroup heading={t("filterBy")}>{fields.map((item) => <CommandItem key={item.key} value={`${item.label} ${item.key}`} onSelect={() => pick(item)}>
            <span className="min-w-0 flex-1 truncate">{item.label}</span><span className="text-xs text-muted-foreground">{t(`fieldTypes.${item.type}`)}</span>
          </CommandItem>)}</CommandGroup>
        </CommandList>
      </Command> : <form className="space-y-3 p-3" onSubmit={(event) => { event.preventDefault(); apply(); }}>
        <div className="flex items-center gap-1.5"><Button type="button" variant="ghost" size="icon-sm" aria-label={t("chooseAnotherField")} onClick={() => setField(null)}><ArrowLeft aria-hidden="true" /></Button><p className="truncate text-sm font-medium">{field.label}</p></div>
        <Field className="gap-1.5"><FieldLabel htmlFor="filter-operand" className="text-xs">{t("condition")}</FieldLabel>
          <NativeSelect id="filter-operand" value={op} onChange={(event) => setOp(event.target.value as Operand)} className="w-full">
            {operandsByType[field.type].map((item) => <NativeSelectOption key={item} value={item}>{t(`operands.${item}`)}</NativeSelectOption>)}
          </NativeSelect></Field>
        {!valuelessOperands.includes(op) && (field.type === "select" || field.type === "multi_select" ? <fieldset className="space-y-1.5"><legend className="mb-1.5 text-xs font-medium">{t("values")}</legend>
          <div className="max-h-48 space-y-1 overflow-y-auto">{(field.options ?? []).map((option) => <Label key={option.value} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm font-normal hover:bg-muted">
            <Checkbox checked={choices.includes(option.value)} onCheckedChange={(checked) => setChoices((list) => checked ? [...list, option.value] : list.filter((value) => value !== option.value))} />{option.label}</Label>)}</div>
        </fieldset> : field.type === "boolean" ? <Field className="gap-1.5"><FieldLabel htmlFor="filter-value" className="text-xs">{t("value")}</FieldLabel>
          <NativeSelect id="filter-value" value={text} onChange={(event) => setText(event.target.value)} className="w-full"><NativeSelectOption value="">{t("chooseValue")}</NativeSelectOption><NativeSelectOption value="true">{t("yes")}</NativeSelectOption><NativeSelectOption value="false">{t("no")}</NativeSelectOption></NativeSelect>
        </Field> : field.type === "relation" ? <div className="space-y-1.5"><p className="text-xs font-medium">{t("value")}{relatedName && <span className="ml-1 font-normal text-muted-foreground">{t("selectedValue", { value: relatedName })}</span>}</p>
          <RelationSearch endpoint={`/api/workspaces/${tenantId}/${field.relationTarget === "company" ? "companies" : "contacts"}`} value={text} onChange={(id, name) => { setText(id); setRelatedName(name); }} />
        </div> : <Field className="gap-1.5"><FieldLabel htmlFor="filter-value" className="text-xs">{t("value")}</FieldLabel>
          <Input id="filter-value" type={inputType[field.type] ?? "text"} value={text} maxLength={500} onChange={(event) => setText(event.target.value)} autoFocus /></Field>)}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => reset(false)}>{t("cancel")}</Button><Button size="sm">{t("applyFilter")}</Button></div>
      </form>}
    </PopoverContent>
  </Popover>;
}
