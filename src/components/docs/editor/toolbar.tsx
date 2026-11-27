/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): components/ui/custom/tiptap/toolbars/editor-toolbar.tsx and components/ui/custom/tiptap/toolbars/color-and-highlight.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { Fragment, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { Toolbar as ToolbarPrimitive } from "radix-ui";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, Code, Code2, Columns2, Highlighter, Italic, Link as LinkIcon, List, ListChecks, ListCollapse, ListOrdered, Minus, Palette, Quote, Redo2, RemoveFormatting, Strikethrough, Table, Underline, Undo2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { docColors, docHighlights, safeDocHref } from "@/lib/docs";
import { colorKeys } from "@/components/docs/editor/slash-items";
import { cn } from "@/lib/utils";

const aligns = [{ id: "left", icon: AlignLeft }, { id: "center", icon: AlignCenter }, { id: "right", icon: AlignRight }, { id: "justify", icon: AlignJustify }] as const;
const target = "size-11 lg:size-8";
function firstBlockLevel(e: Editor) {
  let level = 0, found = false;
  e.state.doc.nodesBetween(e.state.selection.from, e.state.selection.to, (node) => { if (!found && node.isTextblock) { found = true; level = node.type.name === "heading" ? Number(node.attrs.level) : 0; } return !found; });
  return level;
}

function Tool({ label, shortcut, children }: { label: string; shortcut?: string; children: React.ReactNode }) {
  return <Tooltip><TooltipTrigger asChild><ToolbarPrimitive.Button asChild>{children as React.ReactElement}</ToolbarPrimitive.Button></TooltipTrigger>
    <TooltipContent>{label}{shortcut ? <span className="ms-2 text-muted-foreground">{shortcut}</span> : null}</TooltipContent></Tooltip>;
}
const Sep = () => <ToolbarPrimitive.Separator className="mx-1 h-6 w-px shrink-0 bg-border" />;

/**
 * The fixed formatting toolbar. Radix Toolbar gives one tab stop and arrow-key movement; every button is a shared Toggle, Button or DropdownMenu and names its action
 * (tooltip and accessible name). It scrolls sideways on a narrow screen; targets are 44px below 1024px.
 */
/** `extras`: actions another editor adds near the start of the bar, after undo and redo, so they stay in view (the blog's in-body picture), with the same look, tooltip and 44px targets. */
export type ToolbarExtra = { label: string; icon: typeof Bold; onSelect: () => void };
export function EditorToolbar({ editor, extras = [] }: { editor: Editor; extras?: readonly ToolbarExtra[] }) {
  const t = useTranslations("Docs.toolbar"), c = useTranslations("Docs");
  const s = useEditorState({ editor, selector: ({ editor: e }) => ({
    undo: e.can().undo(), redo: e.can().redo(), bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"), code: e.isActive("code"),
    bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), task: e.isActive("taskList"), details: e.isActive("details"), quote: e.isActive("blockquote"), codeBlock: e.isActive("codeBlock"),
    link: e.isActive("link"), href: (e.getAttributes("link").href as string | undefined) ?? "", table: e.isActive("table"),
    // The block the selection starts in (a selection that spans several blocks shows its first).
    level: firstBlockLevel(e),
    align: aligns.find((a) => e.isActive({ textAlign: a.id }))?.id ?? "left", color: (e.getAttributes("textStyle").color as string | undefined) ?? "", highlight: (e.getAttributes("highlight").color as string | undefined) ?? "",
  }) });
  const [href, setHref] = useState(""), [linkOpen, setLinkOpen] = useState(false);
  const run = () => editor.chain().focus();
  const AlignIcon = aligns.find((a) => a.id === s.align)?.icon ?? AlignLeft;
  function applyLink() {
    const safe = safeDocHref(href.trim()) ?? safeDocHref(`https://${href.trim()}`);
    if (safe) run().extendMarkRange("link").setLink({ href: safe }).run();
    setLinkOpen(false); setHref("");
  }
  const toggle = (label: string, pressed: boolean, Icon: typeof Bold, action: () => void, shortcut?: string) =>
    <Tool label={label} shortcut={shortcut}><Toggle size="sm" pressed={pressed} onPressedChange={action} aria-label={label}><Icon aria-hidden="true" /></Toggle></Tool>;
  const button = (label: string, Icon: typeof Bold, action: () => void, disabled = false, shortcut?: string) =>
    <Tool label={label} shortcut={shortcut}><Button type="button" variant="ghost" size="icon" className={target} aria-label={label} disabled={disabled} onClick={action}><Icon aria-hidden="true" /></Button></Tool>;
  const swatches = (kind: "color" | "highlight") => {
    const list = kind === "color" ? docColors : docHighlights, current = kind === "color" ? s.color : s.highlight;
    return <DropdownMenuContent align="start" className="w-48">
      {list.map((hex, i) => <DropdownMenuItem key={hex} className="min-h-11 gap-2" aria-current={current === hex || undefined} onSelect={() => kind === "color" ? run().setColor(hex).run() : run().setHighlight({ color: hex }).run()}>
        <span className="size-4 shrink-0 rounded-full border" style={{ background: hex }} aria-hidden="true" />{c(`colorName.${colorKeys[i]}` as "colorName.red")}</DropdownMenuItem>)}
      <DropdownMenuSeparator />
      <DropdownMenuItem className="min-h-11" onSelect={() => kind === "color" ? run().unsetColor().run() : run().unsetHighlight().run()}>{t(kind === "color" ? "noColor" : "noHighlight")}</DropdownMenuItem>
    </DropdownMenuContent>;
  };
  return <TooltipProvider delayDuration={400}>
    <ToolbarPrimitive.Root aria-label={t("label")} data-docs-toolbar className="flex items-center gap-0.5 overflow-x-auto px-2 py-1 [scrollbar-width:thin]"
      onMouseDown={(e) => { if (e.currentTarget.contains(e.target as Node) && !(e.target as HTMLElement).closest("input")) e.preventDefault(); }}>
      {button(t("undo"), Undo2, () => run().undo().run(), !s.undo, "Ctrl+Z")}
      {button(t("redo"), Redo2, () => run().redo().run(), !s.redo, "Ctrl+Shift+Z")}
      <Sep />
      {extras.length > 0 && <>{extras.map((extra) => <Fragment key={extra.label}>{button(extra.label, extra.icon, extra.onSelect)}</Fragment>)}<Sep /></>}
      <DropdownMenu><Tool label={t("textStyle")}><DropdownMenuTrigger asChild><Button type="button" variant="ghost" className="h-11 min-w-28 justify-between gap-1 px-2 lg:h-8" aria-label={t("textStyle")}>{s.level ? t(`h${s.level}` as "h1") : t("normal")}<ChevronDown className="size-3.5" aria-hidden="true" /></Button></DropdownMenuTrigger></Tool>
        <DropdownMenuContent align="start">
          <DropdownMenuItem className="min-h-11" aria-current={s.level === 0 || undefined} onSelect={() => run().setParagraph().run()}>{t("normal")}</DropdownMenuItem>
          {[1, 2, 3, 4].map((l) => <DropdownMenuItem key={l} className="min-h-11" aria-current={s.level === l || undefined} onSelect={() => run().setHeading({ level: l as 1 }).run()}>{t(`h${l}` as "h1")}</DropdownMenuItem>)}
        </DropdownMenuContent></DropdownMenu>
      <Sep />
      {toggle(t("bold"), s.bold, Bold, () => run().toggleBold().run(), "Ctrl+B")}
      {toggle(t("italic"), s.italic, Italic, () => run().toggleItalic().run(), "Ctrl+I")}
      {toggle(t("underline"), s.underline, Underline, () => run().toggleUnderline().run(), "Ctrl+U")}
      {toggle(t("strike"), s.strike, Strikethrough, () => run().toggleStrike().run())}
      {toggle(t("inlineCode"), s.code, Code, () => run().toggleCode().run(), "Ctrl+E")}
      <DropdownMenu><Tool label={t("textColor")}><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className={cn(target, "relative")} aria-label={t("textColor")}><Palette aria-hidden="true" />
        {s.color && <span className="absolute inset-x-2 bottom-1 h-0.5 rounded" style={{ background: s.color }} aria-hidden="true" />}</Button></DropdownMenuTrigger></Tool>{swatches("color")}</DropdownMenu>
      <DropdownMenu><Tool label={t("highlight")}><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className={cn(target, "relative")} aria-label={t("highlight")}><Highlighter aria-hidden="true" />
        {s.highlight && <span className="absolute inset-x-2 bottom-1 h-0.5 rounded" style={{ background: s.highlight }} aria-hidden="true" />}</Button></DropdownMenuTrigger></Tool>{swatches("highlight")}</DropdownMenu>
      <DropdownMenu><Tool label={t("alignment")}><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className={target} aria-label={t("alignment")}><AlignIcon aria-hidden="true" /></Button></DropdownMenuTrigger></Tool>
        <DropdownMenuContent align="start">{aligns.map((a) => <DropdownMenuItem key={a.id} className="min-h-11 gap-2" aria-current={s.align === a.id || undefined} onSelect={() => run().setTextAlign(a.id).run()}><a.icon aria-hidden="true" />{t(`align-${a.id}` as "align-left")}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
      <Sep />
      {toggle(t("bulletList"), s.bullet, List, () => run().toggleBulletList().run())}
      {toggle(t("numberedList"), s.ordered, ListOrdered, () => run().toggleOrderedList().run())}
      {toggle(t("checklist"), s.task, ListChecks, () => run().toggleTaskList().run())}
      {toggle(t("toggleList"), s.details, ListCollapse, () => { if (s.details) run().unsetDetails().run(); else run().setDetails().run(); })}
      <Sep />
      {s.link
        ? <Tool label={t("unlink")}><Toggle size="sm" pressed aria-label={t("unlink")} onPressedChange={() => run().unsetLink().run()}><Unlink aria-hidden="true" /></Toggle></Tool>
        : <Popover open={linkOpen} onOpenChange={setLinkOpen}><Tool label={t("link")} shortcut="Ctrl+K"><PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className={target} aria-label={t("link")}><LinkIcon aria-hidden="true" /></Button></PopoverTrigger></Tool>
          <PopoverContent className="w-80 space-y-2" onCloseAutoFocus={(e) => { e.preventDefault(); editor.commands.focus(); }}>
            <Input className="min-h-11" value={href} placeholder={t("linkPlaceholder")} aria-label={t("linkAddress")} onChange={(e) => setHref(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } }} />
            <Button type="button" className="min-h-11 w-full" disabled={!href.trim()} onClick={applyLink}>{t("addLink")}</Button></PopoverContent></Popover>}
      {toggle(t("quote"), s.quote, Quote, () => run().toggleBlockquote().run())}
      {toggle(t("codeBlock"), s.codeBlock, Code2, () => run().toggleCodeBlock().run())}
      {button(t("divider"), Minus, () => run().setHorizontalRule().run())}
      <DropdownMenu><Tool label={t("table")}><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className={target} aria-label={t("table")}><Table aria-hidden="true" /></Button></DropdownMenuTrigger></Tool>
        <DropdownMenuContent align="start">
          <DropdownMenuItem className="min-h-11" onSelect={() => run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>{t("insertTable")}</DropdownMenuItem>
          {s.table && <><DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11" onSelect={() => run().addRowAfter().run()}>{t("addRow")}</DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={() => run().addColumnAfter().run()}>{t("addColumn")}</DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={() => run().toggleHeaderRow().run()}>{t("headerRow")}</DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={() => run().deleteRow().run()}>{t("deleteRow")}</DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={() => run().deleteColumn().run()}>{t("deleteColumn")}</DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => run().deleteTable().run()}>{t("deleteTable")}</DropdownMenuItem></>}
        </DropdownMenuContent></DropdownMenu>
      {button(t("columns"), Columns2, () => run().insertContent({ type: "columns", content: [{ type: "column", content: [{ type: "paragraph" }] }, { type: "column", content: [{ type: "paragraph" }] }] }).run())}
      {button(t("clearFormatting"), RemoveFormatting, () => run().unsetAllMarks().clearNodes().run())}
    </ToolbarPrimitive.Root>
  </TooltipProvider>;
}
