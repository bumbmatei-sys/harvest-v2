"use client";
import { useTranslations } from "next-intl";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { pageFonts, pageSizes, pageWidths, type PageStyle, type ResolvedPageStyle } from "@/lib/docs";

/** Page styles of the current page (font, size, width, what the header shows, what sits under it) and the live text statistics. Stored per page. */
export function PageStylesPanel({ style, stats, disabled, onChange, onFocusMode }: {
  style: ResolvedPageStyle; stats: { words: number; characters: number; readingMinutes: number }; disabled: boolean; onChange: (next: PageStyle) => void; onFocusMode: () => void;
}) {
  const t = useTranslations("Docs.styles");
  const row = (id: string, label: string, checked: boolean, set: (v: boolean) => void) => <div className="flex min-h-11 items-center justify-between gap-3"><Label htmlFor={id}>{label}</Label><Switch id={id} checked={checked} disabled={disabled} onCheckedChange={set} /></div>;
  const group = <K extends "font" | "size" | "width">(key: K, label: string, list: readonly string[]) => <div className="space-y-2"><Label id={`style-${key}`}>{label}</Label>
    <ToggleGroup type="single" variant="outline" aria-labelledby={`style-${key}`} value={style[key]} disabled={disabled} className="w-full" onValueChange={(v) => { if (v) onChange({ ...custom(style), [key]: v }); }}>
      {list.map((v) => <ToggleGroupItem key={v} value={v} className="flex-1" aria-label={t(`${key}.${v}` as "font.sans")}>{t(`${key}.${v}` as "font.sans")}</ToggleGroupItem>)}</ToggleGroup></div>;
  return <div className="space-y-5" data-docs-styles>
    {group("font", t("fontStyle"), pageFonts)}
    {group("size", t("fontSize"), pageSizes)}
    {group("width", t("pageWidth"), pageWidths)}
    <fieldset className="space-y-1"><legend className="mb-1 text-sm font-medium">{t("header")}</legend>
      {row("style-owner", t("owner"), style.header.owner, (v) => onChange({ ...custom(style), header: { ...style.header, owner: v } }))}
      {row("style-updated", t("lastModified"), style.header.updated, (v) => onChange({ ...custom(style), header: { ...style.header, updated: v } }))}</fieldset>
    <fieldset className="space-y-1"><legend className="mb-1 text-sm font-medium">{t("sections")}</legend>
      {row("style-subpages", t("subpages"), style.sections.subpages, (v) => onChange({ ...custom(style), sections: { ...style.sections, subpages: v } }))}
      {row("style-outline", t("outline"), style.sections.outline, (v) => onChange({ ...custom(style), sections: { ...style.sections, outline: v } }))}</fieldset>
    <Button type="button" variant="outline" className="min-h-11 w-full justify-start" onClick={onFocusMode}><Maximize2 aria-hidden="true" />{t("focusMode")}</Button>
    <dl className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-center" aria-label={t("stats")}>
      <div><dd className="text-lg font-semibold tabular-nums">{stats.words}</dd><dt className="text-xs text-muted-foreground">{t("words")}</dt></div>
      <div><dd className="text-lg font-semibold tabular-nums">{stats.characters}</dd><dt className="text-xs text-muted-foreground">{t("characters")}</dt></div>
      <div><dd className="text-lg font-semibold tabular-nums">{stats.readingMinutes}</dd><dt className="text-xs text-muted-foreground">{t("readingMinutes")}</dt></div>
    </dl>
  </div>;
}
const custom = (s: ResolvedPageStyle): PageStyle => ({ font: s.font, size: s.size, width: s.width, header: s.header, sections: s.sections });
