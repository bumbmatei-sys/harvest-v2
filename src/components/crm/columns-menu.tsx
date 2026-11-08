"use client";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { MAX_COLUMNS, type Density } from "@/lib/crm-fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";

/** Show, hide and reorder columns (Name is fixed first) and pick row density. */
export function ColumnsMenu({ available, visible, density, onChange }: {
  available: { key: string; label: string }[]; visible: string[]; density: Density;
  onChange: (next: { columns?: string[]; density?: Density }) => void;
}) {
  const t = useTranslations("Crm");
  const label = (key: string) => available.find((item) => item.key === key)?.label ?? key;
  const hidden = available.filter((item) => !visible.includes(item.key));
  function move(index: number, delta: number) {
    const next = [...visible], [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange({ columns: next });
  }
  return <Popover>
    <PopoverTrigger asChild><Button variant="outline" size="responsive"><Columns3 aria-hidden="true" /><span className="sr-only sm:not-sr-only">{t("columns")}</span></Button></PopoverTrigger>
    <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-0">
      <div className="max-h-[min(28rem,70vh)] overflow-y-auto p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{t("shownColumns")}</p>
        <ul className="space-y-0.5" aria-label={t("shownColumns")}>
          <li className="flex h-8 items-center gap-2 px-1 text-sm text-muted-foreground"><Checkbox checked disabled aria-label={t("fields.name")} />{t("fields.name")}</li>
          {visible.map((key, index) => <li key={key} className="flex h-8 items-center gap-2 rounded-md px-1 text-sm hover:bg-muted">
            <Checkbox id={`column-${key}`} checked onCheckedChange={() => onChange({ columns: visible.filter((item) => item !== key) })} />
            <Label htmlFor={`column-${key}`} className="min-w-0 flex-1 truncate font-normal">{label(key)}</Label>
            <Button variant="ghost" size="icon-xs" disabled={index === 0} aria-label={t("moveColumnUp", { column: label(key) })} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" /></Button>
            <Button variant="ghost" size="icon-xs" disabled={index === visible.length - 1} aria-label={t("moveColumnDown", { column: label(key) })} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" /></Button>
          </li>)}
        </ul>
        {hidden.length > 0 && <><p className="mt-3 mb-2 text-xs font-medium text-muted-foreground">{t("hiddenColumns")}</p>
          <ul className="space-y-0.5" aria-label={t("hiddenColumns")}>{hidden.map((item) => <li key={item.key} className="flex h-8 items-center gap-2 rounded-md px-1 text-sm hover:bg-muted">
            <Checkbox id={`column-${item.key}`} checked={false} disabled={visible.length >= MAX_COLUMNS} onCheckedChange={() => onChange({ columns: [...visible, item.key] })} />
            <Label htmlFor={`column-${item.key}`} className="min-w-0 flex-1 truncate font-normal">{item.label}</Label>
          </li>)}</ul></>}
      </div>
      <Separator />
      <div className="p-3"><p id="density-label" className="mb-2 text-xs font-medium text-muted-foreground">{t("density")}</p>
        <RadioGroup aria-labelledby="density-label" value={density} onValueChange={(value) => onChange({ density: value as Density })} className="flex gap-4">
          {(["comfortable", "compact"] as const).map((value) => <Label key={value} className="flex items-center gap-2 text-sm font-normal"><RadioGroupItem value={value} />{t(`densities.${value}`)}</Label>)}
        </RadioGroup></div>
    </PopoverContent>
  </Popover>;
}
