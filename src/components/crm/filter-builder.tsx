"use client";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ListFilter, X } from "lucide-react";
import { MAX_FILTERS, operandsByType, valuelessOperands, validateFilter, type FieldType, type Filter, type FilterField, type Operand } from "@/lib/crm-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCrmRequest } from "./request";

/** A filterable field with its display label and, for choices, labelled options. */
export type FieldMeta = FilterField & { label: string };

function RelationSearch({ endpoint, value, onChange }: { endpoint: string; value: string; onChange: (id: string, name: string) => void }) {
  const t = useTranslations("Crm");
  const crmRequest = useCrmRequest();
  const [items, setItems] = useState<{ id: string; name: string }[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), ticket = useRef(0);
  useEffect(() => () => { clearTimeout(timer.current); ticket.current++; }, []);
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

type FilterBuilderProps = {
  fields: FieldMeta[]; tenantId: string; filters: Filter[]; open: boolean; editing: number | null; relatedNames: Record<string, string>;
  onOpenChange: (open: boolean) => void;
  onApply: (filters: Filter[], names: Record<string, string>) => void;
  chipText: (filter: Filter, names?: Record<string, string>) => string;
};

/** One shared, transactional filter panel. Closing unmounts the draft without changing URL state. */
export function FilterBuilder(props: FilterBuilderProps) {
  const t = useTranslations("Crm");
  return <Popover open={props.open} onOpenChange={props.onOpenChange}>
    <Tooltip><TooltipTrigger asChild><PopoverTrigger asChild>
      <Button variant="outline" size="icon-responsive" aria-label={t("filters")} data-active={props.filters.length > 0} className="data-[active=true]:bg-accent"><ListFilter aria-hidden="true" /></Button>
    </PopoverTrigger></TooltipTrigger><TooltipContent>{t("filters")}</TooltipContent></Tooltip>
    <PopoverContent aria-label={t("filters")} align="end" collisionPadding={16} className="flex max-h-[min(38rem,var(--radix-popover-content-available-height))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden p-0">
      {props.open && <FilterSession {...props} />}
    </PopoverContent>
  </Popover>;
}

function FilterSession({ fields, tenantId, filters, editing, relatedNames, onOpenChange, onApply, chipText }: FilterBuilderProps) {
  const t = useTranslations("Crm"), id = useId();
  const initial = editing === null ? undefined : filters[editing];
  const [draft, setDraft] = useState(filters), [index, setIndex] = useState<number | null>(editing);
  const [field, setField] = useState<FieldMeta | null>(() => fields.find((item) => item.key === initial?.field) ?? null);
  const [op, setOp] = useState<Operand>(initial?.op ?? "contains"), [text, setText] = useState(typeof initial?.value === "string" ? initial.value : "");
  const [choices, setChoices] = useState<string[]>(Array.isArray(initial?.value) ? initial.value : initial?.value ? initial.value.split(",") : []);
  const [names, setNames] = useState<Record<string, string>>({}), [relatedName, setRelatedName] = useState(typeof initial?.value === "string" ? relatedNames[initial.value] ?? "" : ""), [error, setError] = useState("");
  function pick(next: FieldMeta) { setField(next); setOp(operandsByType[next.type][0]); setText(""); setChoices([]); setRelatedName(""); setError(""); }
  function edit(at: number) {
    const filter = draft[at];
    setIndex(at); setField(fields.find((item) => item.key === filter.field) ?? null); setOp(filter.op);
    setText(typeof filter.value === "string" ? filter.value : "");
    setChoices(Array.isArray(filter.value) ? filter.value : filter.value ? filter.value.split(",") : []);
    setRelatedName(typeof filter.value === "string" ? names[filter.value] ?? relatedNames[filter.value] ?? "" : ""); setError("");
  }
  function candidate() {
    if (!field) return draft;
    const value = valuelessOperands.includes(op) ? null : field.type === "select" || field.type === "multi_select" ? choices.join(",") : text;
    const filter = validateFilter({ field: field.key, op, value }, fields);
    if (!filter) { setError(t("completeTheFilter")); return null; }
    if (index === null && draft.length >= MAX_FILTERS) { setError(t("filterLimit", { max: MAX_FILTERS })); return null; }
    return index === null ? [...draft, filter] : draft.map((item, at) => at === index ? filter : item);
  }
  function stage() {
    const next = candidate(); if (!next) return;
    setDraft(next); setField(null); setIndex(null); setError("");
  }
  function apply() {
    const next = candidate(); if (!next) return;
    if (next.some((filter) => !validateFilter(filter, fields))) { setError(t("completeTheFilter")); return; }
    onApply(next, names); onOpenChange(false);
  }
  const groups = [
    { label: t("contactDetails"), fields: fields.filter((item) => item.builtin && item.key !== "marketing") },
    { label: t("contactPermissions"), fields: fields.filter((item) => item.key === "marketing") },
    { label: t("customFields"), fields: fields.filter((item) => !item.builtin) },
  ];
  const inputType: Partial<Record<FieldType, string>> = { number: "number", date: "date" };
  return <>
    <div className="flex items-center justify-between border-b px-4 py-3"><h2 className="text-sm font-semibold">{t("filters")}</h2><Badge variant="secondary" className="tabular-nums">{t("filterCount", { count: draft.length })}</Badge></div>
    <div className="min-h-0 overflow-y-auto">
      {draft.length > 0 && <ul aria-label={t("draftFilters")} className="space-y-1 border-b p-2">{draft.map((filter, at) => {
        const label = chipText(filter, names);
        return <li key={at} className="flex items-center gap-1 rounded-md bg-muted/50">
          <Button variant="ghost" className="h-auto min-h-11 min-w-0 flex-1 justify-start whitespace-normal px-2 py-2 text-left text-xs font-normal lg:min-h-9" aria-label={t("editFilter", { filter: label })} onClick={() => edit(at)}>{label}</Button>
          <Button variant="ghost" size="icon-responsive" aria-label={t("removeFilter", { filter: label })} onClick={() => { setDraft(draft.filter((_, item) => item !== at)); setField(null); setIndex(null); setError(""); }}><X aria-hidden="true" /></Button>
        </li>;
      })}</ul>}
      {!field ? <Command label={t("filterBy")}>
        <CommandInput aria-label={t("searchFields")} placeholder={t("searchFields")} />
        <CommandList className="max-h-60"><CommandEmpty>{t("noFieldsFound")}</CommandEmpty>
          {groups.filter((group) => group.fields.length > 0).map((group) => <CommandGroup key={group.label} heading={group.label}>{group.fields.map((item) => <CommandItem className="min-h-11 gap-3 lg:min-h-9" key={item.key} value={`${item.label} ${item.key}`} disabled={draft.length >= MAX_FILTERS} onSelect={() => pick(item)}>
            <span className="min-w-0 flex-1 truncate">{item.label}</span><span className="text-xs text-muted-foreground">{t(`fieldTypes.${item.type}`)}</span>
          </CommandItem>)}</CommandGroup>)}
        </CommandList>
      </Command> : <form className="space-y-3 p-3" onSubmit={(event) => { event.preventDefault(); apply(); }}>
        <div className="flex items-center gap-1.5"><Button type="button" variant="ghost" size="icon-responsive" aria-label={t("chooseAnotherField")} onClick={() => { setField(null); setIndex(null); setError(""); }}><ArrowLeft aria-hidden="true" /></Button><p className="truncate text-sm font-medium">{field.label}</p></div>
        <Field className="gap-1.5"><FieldLabel htmlFor={`${id}-operand`} className="text-xs">{t("condition")}</FieldLabel>
          <NativeSelect id={`${id}-operand`} value={op} onChange={(event) => setOp(event.target.value as Operand)} className="h-11 w-full lg:h-9">
            {operandsByType[field.type].map((item) => <NativeSelectOption key={item} value={item}>{t(`operands.${item}`)}</NativeSelectOption>)}
          </NativeSelect></Field>
        {!valuelessOperands.includes(op) && (field.type === "select" || field.type === "multi_select" ? <fieldset className="space-y-1.5"><legend className="mb-1.5 text-xs font-medium">{t("values")}</legend>
          <div className="max-h-48 space-y-1 overflow-y-auto">{(field.options ?? []).map((option) => <Label key={option.value} className="flex min-h-11 items-center gap-2 rounded-md px-2 py-1 text-sm font-normal hover:bg-muted lg:min-h-9">
            <Checkbox checked={choices.includes(option.value)} onCheckedChange={(checked) => setChoices((list) => checked ? [...list, option.value] : list.filter((value) => value !== option.value))} />{option.label}</Label>)}</div>
        </fieldset> : field.type === "boolean" ? <Field className="gap-1.5"><FieldLabel htmlFor={`${id}-value`} className="text-xs">{t("value")}</FieldLabel>
          <NativeSelect id={`${id}-value`} value={text} onChange={(event) => setText(event.target.value)} className="h-11 w-full lg:h-9"><NativeSelectOption value="">{t("chooseValue")}</NativeSelectOption><NativeSelectOption value="true">{t("yes")}</NativeSelectOption><NativeSelectOption value="false">{t("no")}</NativeSelectOption></NativeSelect>
        </Field> : field.type === "relation" ? <div className="space-y-1.5"><p className="text-xs font-medium">{t("value")}{relatedName && <span className="ml-1 font-normal text-muted-foreground">{t("selectedValue", { value: relatedName })}</span>}</p>
          <RelationSearch endpoint={`/api/workspaces/${tenantId}/${field.relationTarget === "company" ? "companies" : "contacts"}`} value={text} onChange={(id, name) => { setText(id); setRelatedName(name); setNames((current) => ({ ...current, [id]: name })); }} />
        </div> : <Field className="gap-1.5"><FieldLabel htmlFor={`${id}-value`} className="text-xs">{t("value")}</FieldLabel>
          <Input id={`${id}-value`} type={inputType[field.type] ?? "text"} value={text} className="h-11 lg:h-9" maxLength={500} onChange={(event) => setText(event.target.value)} autoFocus /></Field>)}

        <Button type="button" variant="outline" size="responsive" className="w-full" onClick={stage}>{t(index === null ? "addCondition" : "updateCondition")}</Button>
      </form>}
      {draft.length >= MAX_FILTERS && !field && <p className="px-3 py-2 text-xs text-muted-foreground">{t("filterLimit", { max: MAX_FILTERS })}</p>}
      {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2 border-t p-3">
      <Button variant="ghost" size="responsive" className="mr-auto px-2" onClick={() => { setDraft([]); setField(null); setIndex(null); setError(""); }}>{t("clearAll")}</Button>
      <Button variant="outline" size="responsive" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
      <Button size="responsive" onClick={apply}>{t("applyFilter")}</Button>
    </div>
  </>;
}
