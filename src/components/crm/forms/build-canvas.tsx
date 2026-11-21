"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent, type Announcements } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, ImageIcon, Lock, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { coverClass } from "@/components/forms/public-form";
import { FormField } from "@/components/forms/form-fields";
import { AddQuestionMenu } from "@/components/crm/forms/add-question-menu";
import { choiceTypes, coverIds, crmFields, formLimits, insertBlock, mappableTypes, moveBlock, newBlock, normalizeBlock, removeBlock, type CrmField, type FormBlock, type FormDefinition, type MenuItem } from "@/lib/crm-forms";

type Change = (fn: (form: FormDefinition) => FormDefinition, key?: string) => void;

function BlockEditor({ block, blocks, onChange }: { block: FormBlock; blocks: FormBlock[]; onChange: (patch: Partial<FormBlock>, key?: string) => void }) {
  const t = useTranslations("CrmForms.block"), id = `block-${block.id}`, options = block.options ?? [];
  const taken = new Set(blocks.filter((b) => b.id !== block.id && b.mapTo).map((b) => b.mapTo as CrmField));
  const fields = crmFields.filter((field) => mappableTypes[field] === block.type);
  return <div className="space-y-4 border-t p-4" data-block-editor>
    <div className="space-y-2"><Label htmlFor={`${id}-label`}>{block.type === "info" ? t("heading") : t("question")}</Label>
      <Input id={`${id}-label`} className="min-h-11" value={block.label} maxLength={formLimits.label} onChange={(e) => onChange({ label: e.target.value }, `label-${block.id}`)} /></div>
    {(block.type === "info" || block.type === "consent") && <div className="space-y-2"><Label htmlFor={`${id}-text`}>{block.type === "info" ? t("body") : t("notice")}</Label>
      <Textarea id={`${id}-text`} rows={block.type === "consent" ? 4 : 3} value={block.text ?? ""} maxLength={formLimits.text} onChange={(e) => onChange({ text: e.target.value }, `text-${block.id}`)} /></div>}
    {choiceTypes.includes(block.type) && <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">{t("options")}</legend>
      {options.map((option, index) => <div key={index} className="flex items-center gap-2">
        <Input className="min-h-11" value={option} maxLength={formLimits.option} aria-label={t("optionNumber", { number: index + 1 })} onChange={(e) => onChange({ options: options.map((o, i) => i === index ? e.target.value : o) }, `option-${block.id}-${index}`)} />
        <Button type="button" variant="ghost" size="icon" className="size-11" disabled={options.length <= 2} aria-label={t("removeOption", { number: index + 1 })} onClick={() => onChange({ options: options.filter((_, i) => i !== index) })}><X aria-hidden="true" /></Button></div>)}
      {options.length < formLimits.options && <Button type="button" variant="outline" className="min-h-11" onClick={() => onChange({ options: [...options, t("optionDefault", { number: options.length + 1 })] })}>{t("addOption")}</Button>}</fieldset>}
    {fields.length > 0 && block.type !== "consent" && <div className="space-y-2"><Label htmlFor={`${id}-map`}>{t("saveTo")}</Label>
      <NativeSelect id={`${id}-map`} className="w-full sm:w-72" value={block.mapTo ?? ""} onChange={(e) => onChange({ mapTo: (e.target.value || null) as CrmField | null })}>
        <NativeSelectOption value="">{t("notMapped")}</NativeSelectOption>
        {fields.map((field) => <NativeSelectOption key={field} value={field} disabled={taken.has(field)}>{t(`fields.${field}`)}</NativeSelectOption>)}</NativeSelect></div>}
    {block.type !== "info" && block.type !== "consent" && <Label htmlFor={`${id}-required`} className="flex min-h-11 items-center gap-3 font-normal">
      <Switch id={`${id}-required`} checked={block.required} onCheckedChange={(required) => onChange({ required })} />{t("required")}</Label>}
  </div>;
}

function SortableBlock({ block, index, count, blocks, selected, onSelect, onChange, onMove, onRemove }: {
  block: FormBlock; index: number; count: number; blocks: FormBlock[]; selected: boolean; onSelect: () => void;
  onChange: (patch: Partial<FormBlock>, key?: string) => void; onMove: (by: number) => void; onRemove: () => void;
}) {
  const t = useTranslations("CrmForms.block"), types = useTranslations("CrmForms.types");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-block={block.id} data-block-type={block.type}
    className={cn("rounded-xl border bg-card", selected && "border-primary/50 ring-1 ring-primary/30", isDragging && "relative z-10 opacity-80 shadow-lg")}>
    <div className="flex min-h-11 flex-wrap items-center gap-1 px-2 py-1">
      <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={t("drag", { label: block.label })}
        className="flex size-11 touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"><GripVertical aria-hidden="true" /></button>
      <Badge variant="secondary">{types(block.type)}</Badge>
      {block.mapTo && <Badge variant="outline">{t("savesTo", { field: t(`fields.${block.mapTo}`) })}</Badge>}
      {block.required && block.type !== "info" && <Badge variant="outline">{t("requiredBadge")}</Badge>}
      <span className="flex-1" />
      <Button type="button" variant="ghost" size="icon" className="size-11" disabled={index === 0} aria-label={t("moveUp", { label: block.label })} onClick={() => onMove(-1)}><ArrowUp aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon" className="size-11" disabled={index === count - 1} aria-label={t("moveDown", { label: block.label })} onClick={() => onMove(1)}><ArrowDown aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("remove", { label: block.label })} onClick={onRemove}><Trash2 aria-hidden="true" /></Button>
    </div>
    <div className="px-4 pb-4">
      <button type="button" aria-expanded={selected} aria-label={t("edit", { label: block.label })} onClick={onSelect} className="mb-3 min-h-11 w-full rounded-md text-left text-xs text-muted-foreground outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">{selected ? t("editing") : t("editHint")}</button>
      <div inert className="pointer-events-none"><FormField block={block} value={undefined} onChange={() => {}} idPrefix="canvas" disabled /></div>
    </div>
    {selected && <BlockEditor block={block} blocks={blocks} onChange={onChange} />}
  </li>;
}

/** The Build canvas: cover, logo, title and description, then the questions (drag, or Move up and Move down), the pinned consent block and Add question. */
export function BuildCanvas({ form, change, selected, setSelected, notify }: { form: FormDefinition; change: Change; selected: string | null; setSelected: (id: string | null) => void; notify: (message: string) => void }) {
  const t = useTranslations("CrmForms"), b = useTranslations("CrmForms.block"), types = useTranslations("CrmForms.types"), menu = useTranslations("CrmForms.menu"), dnd = useTranslations("CrmForms.dnd");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const questions = form.blocks.filter((block) => block.type !== "consent"), consent = form.blocks.find((block) => block.type === "consent");
  const label = (id: string | number) => form.blocks.find((x) => x.id === id)?.label ?? "";
  const [logoOpen, setLogoOpen] = useState(false);
  const optionPair = (): [string, string] => [t("defaults.optionOne"), t("defaults.optionTwo")];
  const announcements: Announcements = {
    onDragStart: ({ active }: DragStartEvent) => dnd("start", { label: label(active.id) }),
    onDragOver: ({ active, over }) => over ? dnd("over", { label: label(active.id), position: questions.findIndex((x) => x.id === over.id) + 1, total: questions.length }) : undefined,
    onDragEnd: ({ active, over }) => over ? dnd("end", { label: label(active.id), position: questions.findIndex((x) => x.id === over.id) + 1, total: questions.length }) : dnd("cancel", { label: label(active.id) }),
    onDragCancel: ({ active }) => dnd("cancel", { label: label(active.id) }),
  };
  function end(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = form.blocks.findIndex((x) => x.id === active.id), to = form.blocks.findIndex((x) => x.id === over.id);
    change((f) => ({ ...f, blocks: moveBlock(f.blocks, from, to) }));
  }
  const move = (index: number, by: number) => { change((f) => ({ ...f, blocks: moveBlock(f.blocks, index, index + by) })); notify(dnd("moved", { label: questions[index].label, position: index + by + 1, total: questions.length })); };
  function add(item: MenuItem) {
    const block = newBlock(item, menu(`items.${item.id}`), optionPair());
    change((f) => ({ ...f, blocks: insertBlock(f.blocks, block) })); setSelected(block.id);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-block="${block.id}"]`)?.scrollIntoView({ block: "nearest" }));
  }
  const patch = (id: string) => (p: Partial<FormBlock>, key?: string) => change((f) => ({ ...f, blocks: f.blocks.map((x) => x.id === id ? normalizeBlock({ ...x, ...p }, optionPair()) : x) }), key);

  return <div className="mx-auto w-full max-w-3xl space-y-6" data-build-canvas>
    <div className="space-y-4">
      <Popover><PopoverTrigger asChild><Button type="button" variant="ghost" className="min-h-11 text-muted-foreground"><ImageIcon aria-hidden="true" />{form.cover === "none" ? t("cover.add") : t("cover.change")}</Button></PopoverTrigger>
        <PopoverContent align="start" className="w-72"><div role="radiogroup" aria-label={t("cover.label")} className="grid grid-cols-3 gap-2">
          {coverIds.map((id) => <button key={id} type="button" role="radio" aria-checked={form.cover === id} aria-label={t(`cover.options.${id}`)} onClick={() => change((f) => ({ ...f, cover: id }))}
            className={cn("h-14 rounded-md border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", coverClass[id] || "bg-card", form.cover === id && "ring-2 ring-primary")}>{id === "none" && <X className="mx-auto size-4 text-muted-foreground" aria-hidden="true" />}</button>)}</div></PopoverContent></Popover>
      {form.cover !== "none" && <div className={cn("h-28 w-full rounded-xl sm:h-36", coverClass[form.cover])} aria-hidden="true" />}
      <Popover open={logoOpen} onOpenChange={setLogoOpen}><PopoverTrigger asChild>
        <button type="button" aria-label={form.logoUrl ? t("logo.change") : t("logo.add")} className="flex size-20 items-center justify-center overflow-hidden rounded-xl border bg-card text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          {form.logoUrl ? <img src={form.logoUrl} alt="" className="size-full object-cover" /> : <ImageIcon aria-hidden="true" />}</button></PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-2"><Label htmlFor="form-logo">{t("logo.url")}</Label>
          <Input id="form-logo" className="min-h-11" inputMode="url" placeholder={t("logo.placeholder")} value={form.logoUrl} maxLength={formLimits.url} onChange={(e) => change((f) => ({ ...f, logoUrl: e.target.value.trim() }), "logo")} />
          {form.logoUrl && !/^https:\/\//.test(form.logoUrl) && <p role="alert" className="text-sm text-destructive">{t("logo.invalid")}</p>}</PopoverContent></Popover>
      <Input aria-label={t("titleLabel")} className="h-auto min-h-12 border-0 border-b rounded-none px-0 text-3xl font-semibold shadow-none focus-visible:ring-0 md:text-3xl" value={form.title} maxLength={formLimits.title}
        onChange={(e) => change((f) => ({ ...f, title: e.target.value }), "title")} />
      <Textarea aria-label={t("descriptionLabel")} placeholder={t("descriptionPlaceholder")} rows={2} className="min-h-0 resize-none border-0 border-b rounded-none px-0 shadow-none focus-visible:ring-0" value={form.description} maxLength={formLimits.description}
        onChange={(e) => change((f) => ({ ...f, description: e.target.value }), "description")} />
    </div>
    <DndContext id="form-blocks" sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={end} accessibility={{ announcements, screenReaderInstructions: { draggable: dnd("instructions") } }}>
      <SortableContext items={questions.map((x) => x.id)} strategy={verticalListSortingStrategy}>
        <ol className="space-y-3" aria-label={t("questionsLabel")} data-question-list>
          {questions.map((block, index) => <SortableBlock key={block.id} block={block} index={index} count={questions.length} blocks={form.blocks} selected={selected === block.id}
            onSelect={() => setSelected(selected === block.id ? null : block.id)} onChange={patch(block.id)} onMove={(by) => move(index, by)}
            onRemove={() => { change((f) => ({ ...f, blocks: removeBlock(f.blocks, block.id) })); if (selected === block.id) setSelected(null); notify(b("removed", { label: block.label })); }} />)}
        </ol>
      </SortableContext>
    </DndContext>
    <AddQuestionMenu usedFields={form.blocks.flatMap((x) => x.mapTo ? [x.mapTo] : [])} onAdd={add} full />
    {consent && <section aria-label={types("consent")} className="rounded-xl border bg-card" data-consent-block>
      <div className="flex min-h-11 flex-wrap items-center gap-2 px-4 py-2"><Lock className="size-4 text-muted-foreground" aria-hidden="true" /><Badge variant="secondary">{types("consent")}</Badge><Badge variant="outline">{b("mandatory")}</Badge>
        <Button type="button" variant="ghost" className="ms-auto min-h-11" aria-expanded={selected === consent.id} onClick={() => setSelected(selected === consent.id ? null : consent.id)}>{b("editConsent")}</Button></div>
      <div className="px-4 pb-4"><div inert className="pointer-events-none"><FormField block={consent} value={undefined} onChange={() => {}} idPrefix="canvas" disabled /></div></div>
      {selected === consent.id && <BlockEditor block={consent} blocks={form.blocks} onChange={patch(consent.id)} />}
    </section>}
  </div>;
}
