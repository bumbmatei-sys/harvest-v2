"use client";
import { useTranslations } from "next-intl";
import { ChevronRight, CircleUser, Clock, FileText, Image as ImageIcon, ListTree, Rows3, SmilePlus, Text, Type, UsersRound, Focus, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PanelShell } from "@/components/docs/panels/panel-shell";
import { pageFonts, pageSizes, relationshipModes, subpageModes, type PageStyle, type ResolvedPageStyle } from "@/lib/docs";
import { cn } from "@/lib/utils";

const custom = (s: ResolvedPageStyle): PageStyle => ({ font: s.font, size: s.size, width: s.width, header: s.header, sections: s.sections, showStats: s.showStats, ...(s.coverFileId ? { coverFileId: s.coverFileId } : {}) });
const AA = "Aa";
const fontGlyph = { sans: AA, serif: "Ss", mono: "00" } as const;
const sizeGlyph = { small: "text-xs", default: "text-base", large: "text-xl" } as const;
const fontFace = { sans: "font-sans", serif: "font-serif", mono: "font-mono" } as const;
/** Reading time shown as seconds under a minute and minutes after. */
export function readingLabel(words: number, t: (key: "seconds" | "minutes", values: { count: number }) => string) { const seconds = Math.round((words / 200) * 60); return seconds < 60 ? t("seconds", { count: seconds }) : t("minutes", { count: Math.round(seconds / 60) }); }

/** Page styles of the open page: typography, header, sections, focus mode and statistics. Stored per page, except the two focus switches (this browser only). */
export function PageStylesPanel({ style, stats, disabled, onChange, onApplyAll, onPickCover, focusBlock, onFocusBlock, focusPage, onFocusPage, onClose }: {
  style: ResolvedPageStyle; stats: { words: number; characters: number; readingMinutes: number }; disabled: boolean; onChange: (next: PageStyle) => void; onApplyAll: () => void; onPickCover: () => void;
  focusBlock: boolean; onFocusBlock: (on: boolean) => void; focusPage: boolean; onFocusPage: (on: boolean) => void; onClose: () => void;
}) {
  const t = useTranslations("Docs.styles"), td = useTranslations("Docs");
  const set = (patch: Partial<PageStyle>) => onChange({ ...custom(style), ...patch });
  const row = (id: string, Icon: typeof Text, label: string, checked: boolean, setter: (v: boolean) => void, off = disabled) => <div className="flex min-h-11 items-center justify-between gap-3"><Label htmlFor={id} className="flex items-center gap-3 font-normal"><Icon className="size-4 text-muted-foreground" aria-hidden="true" />{label}</Label><Switch id={id} checked={checked} disabled={off} onCheckedChange={setter} /></div>;
  const tile = (selected: boolean, label: string, glyph: React.ReactNode, click: () => void) => <button key={label} type="button" role="radio" aria-checked={selected} disabled={disabled} onClick={click}
    className={cn("flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50", selected ? "border-primary bg-selected font-medium text-primary" : "bg-muted/40 hover:bg-accent")}>{glyph}<span className="text-xs">{label}</span></button>;
  const choice = (Icon: typeof Text, label: string, value: string, options: readonly string[], current: string, pick: (v: string) => void, labelOf: (v: string) => string) => <DropdownMenu><DropdownMenuTrigger asChild>
    <button type="button" disabled={disabled} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50" aria-label={td("choiceLabel", { label, value })}>
      <span className="flex items-center gap-3"><Icon className="size-4 text-muted-foreground" aria-hidden="true" />{label}</span><span className="flex items-center gap-1 text-muted-foreground">{value}<ChevronRight className="size-4" aria-hidden="true" /></span></button></DropdownMenuTrigger>
    <DropdownMenuContent align="end"><DropdownMenuRadioGroup value={current} onValueChange={pick}>{options.map((o) => <DropdownMenuRadioItem key={o} value={o} className="min-h-11">{labelOf(o)}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>;
  const heading = (text: string) => <h3 className="mb-1 mt-5 text-xs font-medium text-muted-foreground first:mt-0">{text}</h3>;
  return <PanelShell name="styles" title={td("pageStyles")} onClose={onClose}><div className="p-4" data-docs-styles>
    {heading(t("fontStyle"))}
    <div role="radiogroup" aria-label={t("fontStyle")} className="grid grid-cols-3 gap-2">{pageFonts.map((f) => tile(style.font === f, t(`font.${f}`), <span className={cn("text-base", fontFace[f])} aria-hidden="true">{fontGlyph[f]}</span>, () => set({ font: f })))}</div>
    {heading(t("fontSize"))}
    <div role="radiogroup" aria-label={t("fontSize")} className="grid grid-cols-3 gap-2">{pageSizes.map((s) => tile(style.size === s, t(`size.${s}`), <span className={cn("font-medium", sizeGlyph[s])} aria-hidden="true">{AA}</span>, () => set({ size: s })))}</div>
    {heading(t("pageWidth"))}
    <div role="radiogroup" aria-label={t("pageWidth")} className="grid grid-cols-2 gap-2">{(["default", "full"] as const).map((w) => <button key={w} type="button" role="radio" aria-checked={(style.width === "wide" ? "default" : style.width) === w} disabled={disabled} onClick={() => set({ width: w })}
      className={cn("min-h-11 rounded-lg border text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50", (style.width === "wide" ? "default" : style.width) === w ? "border-primary bg-selected font-medium text-primary" : "bg-muted/40 hover:bg-accent")}>{t(`width.${w}`)}</button>)}</div>
    <Button type="button" variant="ghost" className="mt-2 min-h-11 w-full text-muted-foreground" disabled={disabled} onClick={onApplyAll}>{t("applyAll")}</Button>
    <div className="mt-2 border-t" />
    {heading(t("header"))}
    {row("style-cover", ImageIcon, t("cover"), style.header.cover, (v) => set({ header: { ...style.header, cover: v } }))}
    {style.header.cover && !disabled && <Button type="button" variant="outline" size="sm" className="mb-1 ms-7 min-h-11 lg:min-h-8" onClick={onPickCover}>{style.coverFileId ? t("changeCover") : t("chooseCover")}</Button>}
    {row("style-icon", SmilePlus, t("iconAndTitle"), style.header.icon, (v) => set({ header: { ...style.header, icon: v } }))}
    {row("style-owner", CircleUser, t("owners"), style.header.owner, (v) => set({ header: { ...style.header, owner: v } }))}
    {row("style-contributors", UsersRound, t("contributors"), style.header.contributors, (v) => set({ header: { ...style.header, contributors: v } }))}
    {row("style-subtitle", Type, t("subtitle"), style.header.subtitle, (v) => set({ header: { ...style.header, subtitle: v } }))}
    {row("style-updated", Clock, t("lastModified"), style.header.updated, (v) => set({ header: { ...style.header, updated: v } }))}
    {heading(t("sections"))}
    {choice(Rows3, t("subpages"), t(`subpageMode.${style.sections.subpages}`), subpageModes, style.sections.subpages, (v) => set({ sections: { ...style.sections, subpages: v as (typeof subpageModes)[number] } }), (v) => t(`subpageMode.${v as "off"}`))}
    {choice(Link2, t("relationships"), t(`relationshipMode.${style.sections.relationships}`), relationshipModes, style.sections.relationships, (v) => set({ sections: { ...style.sections, relationships: v as (typeof relationshipModes)[number] } }), (v) => t(`relationshipMode.${v as "dialog"}`))}
    {row("style-outline", ListTree, t("outline"), style.sections.outline, (v) => set({ sections: { ...style.sections, outline: v } }))}
    {heading(t("focusMode"))}
    {row("focus-block", Focus, t("focusBlock"), focusBlock, onFocusBlock, false)}
    {row("focus-page", FileText, t("focusPage"), focusPage, onFocusPage, false)}
    {heading(t("stats"))}
    <dl className="space-y-1 text-sm" aria-label={t("stats")}>
      <div className="flex min-h-9 items-center justify-between"><dt>{t("words")}</dt><dd className="tabular-nums">{stats.words}</dd></div>
      <div className="flex min-h-9 items-center justify-between"><dt>{t("characters")}</dt><dd className="tabular-nums">{stats.characters}</dd></div>
      <div className="flex min-h-9 items-center justify-between"><dt>{t("readingTime")}</dt><dd className="tabular-nums">{readingLabel(stats.words, (k, v) => t(k, v))}</dd></div>
    </dl>
    {row("style-stats", Text, t("showStats"), style.showStats, (v) => set({ showStats: v }))}
  </div></PanelShell>;
}
