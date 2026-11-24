import type { Editor, Range } from "@tiptap/core";
import { Bold, Bookmark, CornerDownRight, Code, Code2, Columns2, FilePlus2, Heading1, Heading2, Heading3, Heading4, Highlighter, Italic, List, ListChecks, ListCollapse, ListOrdered, ListTree, Minus, Palette, Quote, RemoveFormatting, Strikethrough, Table, Type, Underline, type LucideIcon } from "lucide-react";
import { docColors, docHighlights } from "@/lib/docs";
import { AtSign, BadgeCheck, Layout, Link2, MousePointerClick, Pin, TextQuote, Eraser, FileText } from "lucide-react";

export type SlashSection = "suggestions" | "text" | "formatting" | "advanced" | "badges" | "colors" | "highlights";
export const slashSections: readonly SlashSection[] = ["suggestions", "text", "formatting", "advanced", "badges", "colors", "highlights"];
export type InsertKind = "button" | "link" | "markdown" | "template";
export type PageActions = { newPage: (child: boolean) => void; insert: (kind: InsertKind) => void };
export type SlashItem = { id: string; section: SlashSection; icon: LucideIcon; keywords: string; swatch?: string; run: (editor: Editor, range: Range, actions: PageActions) => void };
const colorNames = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "gray"] as const;
const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);
const table = (e: Editor, r: Range) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
const columns = (e: Editor, r: Range) => chain(e, r).insertContent({ type: "columns", content: [{ type: "column", content: [{ type: "paragraph" }] }, { type: "column", content: [{ type: "paragraph" }] }] }).run();
const toggle = (e: Editor, r: Range) => chain(e, r).setDetails().run();
const banner = (tone: string) => (e: Editor, r: Range) => chain(e, r).wrapIn("callout", { tone }).run();
const layout = (n: 2 | 3 | 4) => (e: Editor, r: Range) => chain(e, r).insertContent({ type: "columns", content: Array.from({ length: n }, () => ({ type: "column", content: [{ type: "paragraph" }] })) }).run();
const checklist = (e: Editor, r: Range) => chain(e, r).toggleTaskList().run();

export const slashItems: readonly SlashItem[] = [
  { id: "suggestTable", section: "suggestions", icon: Table, keywords: "table grid", run: table },
  { id: "suggestSubpage", section: "suggestions", icon: CornerDownRight, keywords: "subpage page nested", run: (e, r, a) => { chain(e, r).run(); a.newPage(true); } },
  { id: "suggestToggle", section: "suggestions", icon: ListCollapse, keywords: "toggle collapse details", run: toggle },
  { id: "suggestBanner", section: "suggestions", icon: Bookmark, keywords: "banner callout note", run: banner("info") },
  { id: "suggestChecklist", section: "suggestions", icon: ListChecks, keywords: "checklist todo task", run: checklist },
  { id: "suggestColumns", section: "suggestions", icon: Columns2, keywords: "columns layout", run: columns },
  { id: "suggestPage", section: "suggestions", icon: FilePlus2, keywords: "page new", run: (e, r, a) => { chain(e, r).run(); a.newPage(false); } },
  { id: "paragraph", section: "text", icon: Type, keywords: "normal text paragraph", run: (e, r) => chain(e, r).setParagraph().run() },
  { id: "h1", section: "text", icon: Heading1, keywords: "heading 1 title h1", run: (e, r) => chain(e, r).setHeading({ level: 1 }).run() },
  { id: "h2", section: "text", icon: Heading2, keywords: "heading 2 h2", run: (e, r) => chain(e, r).setHeading({ level: 2 }).run() },
  { id: "h3", section: "text", icon: Heading3, keywords: "heading 3 h3", run: (e, r) => chain(e, r).setHeading({ level: 3 }).run() },
  { id: "h4", section: "text", icon: Heading4, keywords: "heading 4 h4", run: (e, r) => chain(e, r).setHeading({ level: 4 }).run() },
  { id: "bulleted", section: "text", icon: List, keywords: "bulleted list bullets unordered", run: (e, r) => chain(e, r).toggleBulletList().run() },
  { id: "numbered", section: "text", icon: ListOrdered, keywords: "numbered list ordered", run: (e, r) => chain(e, r).toggleOrderedList().run() },
  { id: "checklist", section: "text", icon: ListChecks, keywords: "checklist todo task", run: checklist },
  { id: "toggle", section: "text", icon: ListCollapse, keywords: "toggle list collapse details", run: toggle },
  { id: "bannerInfo", section: "text", icon: Bookmark, keywords: "banner callout info note", run: banner("info"), swatch: "info" },
  { id: "bannerSuccess", section: "text", icon: Bookmark, keywords: "banner callout success", run: banner("success"), swatch: "success" },
  { id: "bannerWarning", section: "text", icon: Bookmark, keywords: "banner callout warning", run: banner("warning"), swatch: "warning" },
  { id: "bannerDanger", section: "text", icon: Bookmark, keywords: "banner callout danger alert", run: banner("danger"), swatch: "danger" },
  { id: "codeBlock", section: "text", icon: Code2, keywords: "code block snippet", run: (e, r) => chain(e, r).toggleCodeBlock().run() },
  { id: "quote", section: "text", icon: Quote, keywords: "quote blockquote", run: (e, r) => chain(e, r).toggleBlockquote().run() },
  { id: "pullQuote", section: "text", icon: TextQuote, keywords: "pull quote large quotation", run: (e, r) => chain(e, r).toggleBlockquote().updateAttributes("blockquote", { pull: true }).run() },
  { id: "divider", section: "text", icon: Minus, keywords: "divider line rule separator", run: (e, r) => chain(e, r).setHorizontalRule().run() },
  { id: "bold", section: "formatting", icon: Bold, keywords: "bold strong", run: (e, r) => chain(e, r).toggleBold().run() },
  { id: "italic", section: "formatting", icon: Italic, keywords: "italic emphasis", run: (e, r) => chain(e, r).toggleItalic().run() },
  { id: "underline", section: "formatting", icon: Underline, keywords: "underline", run: (e, r) => chain(e, r).toggleUnderline().run() },
  { id: "strike", section: "formatting", icon: Strikethrough, keywords: "strikethrough strike", run: (e, r) => chain(e, r).toggleStrike().run() },
  { id: "inlineCode", section: "formatting", icon: Code, keywords: "inline code monospace", run: (e, r) => chain(e, r).toggleCode().run() },
  { id: "clear", section: "formatting", icon: RemoveFormatting, keywords: "clear formatting plain", run: (e, r) => chain(e, r).unsetAllMarks().clearNodes().run() },
  { id: "table", section: "advanced", icon: Table, keywords: "table grid", run: table },
  { id: "columns", section: "advanced", icon: Columns2, keywords: "columns layout", run: columns },
  { id: "toc", section: "advanced", icon: ListTree, keywords: "table of contents outline toc", run: (e, r) => chain(e, r).insertContent({ type: "tableOfContents" }).run() },
  { id: "stickyToc", section: "advanced", icon: Pin, keywords: "sticky table of contents outline follow", run: (e, r) => chain(e, r).insertContent({ type: "tableOfContents", attrs: { sticky: true } }).run() },
  { id: "layout2", section: "advanced", icon: Layout, keywords: "layout two columns 2", run: layout(2) },
  { id: "layout3", section: "advanced", icon: Layout, keywords: "layout three columns 3", run: layout(3) },
  { id: "layout4", section: "advanced", icon: Layout, keywords: "layout four columns 4", run: layout(4) },
  { id: "button", section: "advanced", icon: MousePointerClick, keywords: "button call to action", run: (e, r, a) => { chain(e, r).run(); a.insert("button"); } },
  { id: "websiteLink", section: "advanced", icon: Link2, keywords: "website link url address", run: (e, r, a) => { chain(e, r).run(); a.insert("link"); } },
  { id: "markdown", section: "advanced", icon: FileText, keywords: "markdown paste md", run: (e, r, a) => { chain(e, r).run(); a.insert("markdown"); } },
  { id: "template", section: "advanced", icon: FilePlus2, keywords: "template starter", run: (e, r, a) => { chain(e, r).run(); a.insert("template"); } },
  { id: "mention", section: "advanced", icon: AtSign, keywords: "mention person page task at", run: (e, r) => chain(e, r).insertContent("@").run() },
  ...docHighlights.flatMap((hex, i): SlashItem[] => (["light", "strong"] as const).map((tone) => ({ id: `badge-${tone}-${colorNames[i]}`, section: "badges" as const, icon: BadgeCheck, swatch: hex, keywords: `badge label tag ${tone} ${colorNames[i]}`, run: (e: Editor, r: Range) => chain(e, r).setMark("badge", { color: hex, strong: tone === "strong" }).run() }))),
  { id: "badge-remove", section: "badges", icon: Eraser, keywords: "remove badge clear", run: (e, r) => chain(e, r).unsetMark("badge").run() },
  { id: "color-default", section: "colors", icon: Palette, keywords: "default color text reset", run: (e, r) => chain(e, r).unsetColor().run() },
  { id: "highlight-remove", section: "highlights", icon: Eraser, keywords: "remove highlight clear", run: (e, r) => chain(e, r).unsetHighlight().run() },
  ...docColors.map((hex, i): SlashItem => ({ id: `color-${colorNames[i]}`, section: "colors", icon: Palette, swatch: hex, keywords: `color text ${colorNames[i]}`, run: (e, r) => chain(e, r).setColor(hex).run() })),
  ...docHighlights.map((hex, i): SlashItem => ({ id: `highlight-${colorNames[i]}`, section: "highlights", icon: Highlighter, swatch: hex, keywords: `highlight background ${colorNames[i]}`, run: (e, r) => chain(e, r).setHighlight({ color: hex }).run() })),
];
export const colorKeys = colorNames;

/** Items for a query: the Suggestions section only while nothing is typed (its entries repeat the others). Matches the translated label or the English keywords. */
export function filterSlash(query: string, labelOf: (item: SlashItem) => string): SlashItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return slashItems.slice();
  return slashItems.filter((item) => item.section !== "suggestions" && (labelOf(item).toLowerCase().includes(needle) || item.keywords.includes(needle)));
}
