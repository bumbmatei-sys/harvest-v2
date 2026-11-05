"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, MoreHorizontal, Pencil, Plus, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { fieldTypes, slugifyKey, slugifyOption, type FieldOption, type FieldType, type ObjectType } from "@/lib/crm-fields";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCrmRequest } from "./request";

export type SettingsField = { id: string; key: string; label: string; description: string; type: FieldType; required: boolean; options: FieldOption[]; relationTarget: ObjectType | null; archived: boolean; version: number };
type DraftOption = FieldOption & { existing: boolean };

function FieldDialog({ tenantId, objectType, field, open, onOpenChange }: { tenantId: string; objectType: ObjectType; field: SettingsField | null; open: boolean; onOpenChange: (value: boolean) => void }) {
  const t = useTranslations("Crm");
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const [label, setLabel] = useState(field?.label ?? ""), [key, setKey] = useState(field?.key ?? ""), [keyTouched, setKeyTouched] = useState(false);
  const [type, setType] = useState<FieldType>(field?.type ?? "text"), [target, setTarget] = useState<ObjectType>(field?.relationTarget ?? "person");
  const [description, setDescription] = useState(field?.description ?? ""), [required, setRequired] = useState(field?.required ?? false);
  const [options, setOptions] = useState<DraftOption[]>(field?.options.map((option) => ({ ...option, existing: true })) ?? []);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const choice = type === "select" || type === "multi_select";
  function optionValues(list: DraftOption[]) {
    // New options get a stable value from their label; existing values never change.
    const used = new Set(list.filter((item) => item.existing).map((item) => item.value));
    return list.map((item) => {
      if (item.existing) return { value: item.value, label: item.label.trim() };
      let value = slugifyOption(item.label), suffix = 2;
      while (used.has(value)) value = `${slugifyOption(item.label).slice(0, 36)}-${suffix++}`;
      used.add(value);
      return { value, label: item.label.trim() };
    });
  }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const list = choice ? optionValues(options.filter((item) => item.label.trim())) : [];
    if (choice && !list.length) { setError(t("addAtLeastOneOption")); return; }
    setBusy(true);
    const result = field
      ? await crmRequest(`/api/workspaces/${tenantId}/crm/fields/${field.id}`, { method: "PATCH", body: { label: label.trim(), description: description.trim(), required, ...(choice ? { options: list } : {}), version: field.version } })
      : await crmRequest(`/api/workspaces/${tenantId}/crm/fields`, { method: "POST", body: { objectType, label: label.trim(), key: key || slugifyKey(label), type, description: description.trim(), required, options: list, relationTarget: type === "relation" ? target : null } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onOpenChange(false); router.refresh();
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[480px]">
      <DialogHeader><DialogTitle>{field ? t("editFieldTitle", { field: field.label }) : t("newField")}</DialogTitle><DialogDescription>{field ? t("editFieldDescription") : t("newFieldDescription")}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Field className="gap-2"><FieldLabel htmlFor="field-label">{t("fieldLabel")}</FieldLabel>
          <Input id="field-label" required maxLength={60} value={label} autoFocus onChange={(event) => { setLabel(event.target.value); if (!field && !keyTouched) setKey(event.target.value.trim() ? slugifyKey(event.target.value) : ""); }} /></Field>
        <Field className="gap-2"><FieldLabel htmlFor="field-key">{t("fieldKey")}</FieldLabel>
          <Input id="field-key" value={key} maxLength={40} pattern="[a-z][a-z0-9_]{0,39}" disabled={!!field} required={!field} className="font-mono text-xs" aria-describedby="field-key-help" onChange={(event) => { setKeyTouched(true); setKey(event.target.value); }} />
          <FieldDescription id="field-key-help">{t("fieldKeyHelp")}</FieldDescription></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="gap-2"><FieldLabel htmlFor="field-type">{t("fieldType")}</FieldLabel>
            <NativeSelect id="field-type" value={type} disabled={!!field} onChange={(event) => { setType(event.target.value as FieldType); setError(""); }} className="w-full">
              {fieldTypes.map((item) => <NativeSelectOption key={item} value={item}>{t(`fieldTypes.${item}`)}</NativeSelectOption>)}
            </NativeSelect></Field>
          {type === "relation" && <Field className="gap-2"><FieldLabel htmlFor="field-target">{t("relatesTo")}</FieldLabel>
            <NativeSelect id="field-target" value={target} disabled={!!field} onChange={(event) => setTarget(event.target.value as ObjectType)} className="w-full">
              <NativeSelectOption value="person">{t("people")}</NativeSelectOption><NativeSelectOption value="company">{t("companies")}</NativeSelectOption>
            </NativeSelect></Field>}
        </div>
        {field && <p className="-mt-2 text-xs text-muted-foreground">{t("typeCannotChange")}</p>}
        {choice && <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">{t("fieldOptions")}</legend>
          <ul className="space-y-1.5">{options.map((item, index) => <li key={index} className="flex items-center gap-2">
            <Input aria-label={t("optionNumber", { number: index + 1 })} value={item.label} maxLength={60} onChange={(event) => setOptions((list) => list.map((option, position) => position === index ? { ...option, label: event.target.value } : option))} className="h-8" />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("removeOption", { option: item.label || t("optionNumber", { number: index + 1 }) })} onClick={() => setOptions((list) => list.filter((_, position) => position !== index))}><Trash2 aria-hidden="true" /></Button>
          </li>)}</ul>
          <Button type="button" variant="outline" size="sm" disabled={options.length >= 50} onClick={() => setOptions((list) => [...list, { value: "", label: "", existing: false }])}><Plus aria-hidden="true" />{t("addOption")}</Button>
          {field && <p className="text-xs text-muted-foreground">{t("optionsInUseHelp")}</p>}
        </fieldset>}
        <Field className="gap-2"><FieldLabel htmlFor="field-description">{t("description")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel>
          <Textarea id="field-description" value={description} maxLength={280} onChange={(event) => setDescription(event.target.value)} className="min-h-16" /></Field>
        <Label className="flex items-start gap-2 font-normal"><Checkbox checked={required} onCheckedChange={(value) => setRequired(value === true)} className="mt-0.5" />
          <span><span className="block text-sm">{t("requiredField")}</span><span className="block text-xs text-muted-foreground">{t("requiredFieldHelp")}</span></span></Label>
        <DialogFooter><DialogClose asChild><Button type="button" variant="ghost" disabled={busy}>{t("cancel")}</Button></DialogClose><Button disabled={busy}>{busy ? t("saving") : field ? t("saveChanges") : t("createField")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

/** Field definitions for one object type. Owners and admins manage them; everyone else reads. */
export function FieldSettings({ tenantId, objectType, fields, writable }: { tenantId: string; objectType: ObjectType; fields: SettingsField[]; writable: boolean }) {
  const t = useTranslations("Crm");
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const [editing, setEditing] = useState<SettingsField | null>(null), [creating, setCreating] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState("");
  async function archive(field: SettingsField, archived: boolean) {
    setBusy(field.id); setError("");
    const result = await crmRequest(`/api/workspaces/${tenantId}/crm/fields/${field.id}`, { method: "PATCH", body: { archived, version: field.version } });
    setBusy("");
    if (!result.ok) { setError(result.error); return; }
    router.refresh();
  }
  const objectLabel = objectType === "person" ? t("people") : t("companies");
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">{t("fieldCount", { count: fields.filter((field) => !field.archived).length, object: objectLabel })}</p>
      {writable && <Button size="sm" onClick={() => setCreating(true)}><Plus aria-hidden="true" />{t("newField")}</Button>}
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {fields.length ? <Card className="@container gap-0 overflow-hidden py-0"><Table aria-label={t("customFieldsFor", { object: objectLabel })} className="table-fixed">
      <TableHeader><TableRow>
        <TableHead className="pl-4">{t("fieldLabel")}</TableHead><TableHead className="hidden w-48 @xl:table-cell">{t("fieldKey")}</TableHead>
        <TableHead className="w-32">{t("fieldType")}</TableHead><TableHead className="hidden w-24 @2xl:table-cell">{t("requiredColumn")}</TableHead>
        <TableHead className="hidden w-28 @lg:table-cell">{t("status")}</TableHead>{writable && <TableHead className="w-14 pr-4"><span className="sr-only">{t("actions")}</span></TableHead>}
      </TableRow></TableHeader>
      <TableBody>{fields.map((field) => <TableRow key={field.id} className={cn("h-12", field.archived && "text-muted-foreground")}>
        <TableCell className="overflow-hidden pl-4"><span className="block truncate font-medium">{field.label}</span>{field.description && <span className="block truncate text-xs text-muted-foreground">{field.description}</span>}</TableCell>
        <TableCell className="hidden truncate font-mono text-xs text-muted-foreground @xl:table-cell">{field.key}</TableCell>
        <TableCell className="truncate text-xs">{t(`fieldTypes.${field.type}`)}{field.type === "relation" && field.relationTarget && <span className="text-muted-foreground">{t("relationTargetSuffix", { target: field.relationTarget === "company" ? t("companies") : t("people") })}</span>}</TableCell>
        <TableCell className="hidden text-xs @2xl:table-cell">{field.required ? t("yes") : t("no")}</TableCell>
        <TableCell className="hidden @lg:table-cell">{field.archived ? <Badge variant="secondary" className="text-muted-foreground">{t("archived")}</Badge> : <Badge variant="secondary" className="bg-success-tint text-success">{t("active")}</Badge>}</TableCell>
        {writable && <TableCell className="pr-4 text-right"><DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" disabled={busy === field.id} aria-label={t("fieldActions", { field: field.label })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!field.archived && <DropdownMenuItem onSelect={() => setEditing(field)}><Pencil aria-hidden="true" />{t("editFieldMenu")}</DropdownMenuItem>}
            {field.archived ? <DropdownMenuItem onSelect={() => void archive(field, false)}><RotateCcw aria-hidden="true" />{t("restoreField")}</DropdownMenuItem>
              : <DropdownMenuItem onSelect={() => void archive(field, true)}><Archive aria-hidden="true" />{t("archiveField")}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu></TableCell>}
      </TableRow>)}</TableBody>
    </Table></Card> : <Empty className="min-h-[240px] border border-solid bg-card p-7 sm:p-10">
      <EmptyHeader><EmptyMedia variant="icon"><SlidersHorizontal aria-hidden="true" /></EmptyMedia><EmptyTitle><h2>{t("noCustomFieldsTitle", { object: objectLabel })}</h2></EmptyTitle>
        <EmptyDescription>{writable ? t("noCustomFieldsHelp") : t("noCustomFieldsViewer")}</EmptyDescription></EmptyHeader>
      {writable && <EmptyContent><Button size="sm" onClick={() => setCreating(true)}><Plus aria-hidden="true" />{t("newField")}</Button></EmptyContent>}
    </Empty>}
    <p className="text-xs leading-relaxed text-muted-foreground">{t("archiveHelp")}</p>
    {creating && <FieldDialog key="new" tenantId={tenantId} objectType={objectType} field={null} open onOpenChange={setCreating} />}
    {editing && <FieldDialog key={editing.id} tenantId={tenantId} objectType={objectType} field={editing} open onOpenChange={(value) => { if (!value) setEditing(null); }} />}
  </div>;
}
