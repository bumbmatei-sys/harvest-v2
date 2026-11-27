/** Derived from Shadcn UI Kit item dashboard-dropdown10 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Link in bio rework). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { bioLayouts, bioLimits, isLegacyTabId, moveItem, newBlockId, type BioDefinition, type BioLayout } from "@/lib/link-in-bio";
import { cn } from "@/lib/utils";

type Tab = BioDefinition["tabs"][number];

function TabRow({ tab, index, count, name, problem, onRename, onMove, onToggle, onRemove }: {
  tab: Tab; index: number; count: number; name: string; problem: boolean; onRename: (label: string) => void; onMove: (by: number) => void; onToggle: () => void; onRemove: (() => void) | null;
}) {
  const t = useTranslations("LinkInBio.tabsEditor");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-bio-tab-row={tab.id}
    className={cn("flex flex-wrap items-end gap-1 rounded-xl border bg-card p-2", tab.hidden && "opacity-70", isDragging && "relative z-10 shadow-lg")}>
    <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={t("drag", { tab: name })}
      className="flex size-11 touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"><GripVertical aria-hidden="true" /></button>
    <Field className="min-w-40 flex-1" data-invalid={problem || undefined}><FieldLabel htmlFor={`tab-${tab.id}`} className="sr-only">{t("name", { position: index + 1 })}</FieldLabel>
      <Input id={`tab-${tab.id}`} className="min-h-11" maxLength={bioLimits.tabLabel} value={tab.label} placeholder={isLegacyTabId(tab.id) ? name : undefined} aria-invalid={problem || undefined}
        onChange={(event) => onRename(event.target.value)} />{problem && <FieldError>{t("nameProblem")}</FieldError>}</Field>
    <span className="flex">
      <Button type="button" variant="ghost" size="icon" className="size-11" disabled={index === 0} aria-label={t("moveUp", { tab: name })} onClick={() => onMove(-1)}><ArrowUp aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon" className="size-11" disabled={index === count - 1} aria-label={t("moveDown", { tab: name })} onClick={() => onMove(1)}><ArrowDown aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon" className="size-11" aria-pressed={tab.hidden} aria-label={t(tab.hidden ? "show" : "hide", { tab: name })} onClick={onToggle}>{tab.hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</Button>
      <Button type="button" variant="ghost" size="icon" className="size-11" disabled={!onRemove} aria-label={t("remove", { tab: name })} onClick={() => onRemove?.()}><Trash2 aria-hidden="true" /></Button>
    </span>
  </li>;
}

/**
 * The page's tabs: tabs or a single page with no tabs, then up to six tabs to rename, show or hide, reorder (drag with mouse, touch or keyboard, or the
 * move buttons) and remove. Removing a tab moves its blocks to the first remaining tab, so nothing the owner built disappears.
 */
export function BioTabsEditor({ definition, issues, onChange, tabName }: {
  definition: BioDefinition; issues: Record<string, string>; onChange: (patch: Partial<BioDefinition>) => void; tabName: (tab: Tab) => string;
}) {
  const t = useTranslations("LinkInBio.tabsEditor");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const { tabs } = definition;
  const setTabs = (next: Tab[]) => onChange({ tabs: next });
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    setTabs(moveItem(tabs, tabs.findIndex((x) => x.id === active.id), tabs.findIndex((x) => x.id === over.id)));
  }
  function remove(id: string) {
    const rest = tabs.filter((x) => x.id !== id), first = rest[0]?.id;
    if (!first) return;
    onChange({ tabs: rest, blocks: definition.blocks.map((b) => b.tab === id ? { ...b, tab: first } : b) });
  }
  return <div className="space-y-4" data-bio-tabs-editor>
    <RadioGroup value={definition.layout} onValueChange={(value) => onChange({ layout: value as BioLayout })} className="grid gap-2 sm:grid-cols-2" aria-label={t("layout")}>
      {bioLayouts.map((value) => <Label key={value} htmlFor={`bio-layout-${value}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
        <RadioGroupItem id={`bio-layout-${value}`} value={value} />{t(`layouts.${value}`)}</Label>)}
    </RadioGroup>
    {definition.layout === "tabs" && <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={onDragEnd}>
        <SortableContext items={tabs.map((x) => x.id)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2" aria-label={t("heading")}>{tabs.map((tab, index) => <TabRow key={tab.id} tab={tab} index={index} count={tabs.length} name={tabName(tab) || t("untitled", { position: index + 1 })}
            problem={Boolean(issues[`tab:${tab.id}`])} onRename={(label) => setTabs(tabs.map((x) => x.id === tab.id ? { ...x, label } : x))} onMove={(by) => setTabs(moveItem(tabs, index, index + by))}
            onToggle={() => setTabs(tabs.map((x) => x.id === tab.id ? { ...x, hidden: !x.hidden } : x))} onRemove={tabs.length > 1 ? () => remove(tab.id) : null} />)}</ol>
        </SortableContext>
      </DndContext>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className="min-h-11" disabled={tabs.length >= bioLimits.tabs} onClick={() => setTabs([...tabs, { id: newBlockId(tabs.map((x) => x.id)), label: "", hidden: false }])}><Plus aria-hidden="true" />{t("add")}</Button>
        {tabs.length >= bioLimits.tabs && <span className="text-sm text-muted-foreground">{t("max", { max: bioLimits.tabs })}</span>}
      </div>
    </>}
  </div>;
}
