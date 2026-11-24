import { Extension, mergeAttributes, Mark, Node, type AnyExtension, type Editor } from "@tiptap/core";
import { Blockquote } from "@tiptap/extension-blockquote";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { Placeholder } from "@tiptap/extensions";
import { calloutTones, safeDocHref } from "@/lib/docs";
import { TocView } from "@/components/docs/editor/toc-view";

/** A banner: a tinted block with other blocks inside. The tone is one of four fixed values. */
export const Callout = Node.create({
  name: "callout", group: "block", content: "block+", defining: true,
  addAttributes() { return { tone: { default: "info", parseHTML: (el: HTMLElement) => { const v = el.getAttribute("data-tone"); return (calloutTones as readonly string[]).includes(v ?? "") ? v : "info"; }, renderHTML: (a: { tone: string }) => ({ "data-tone": a.tone }) } }; },
  parseHTML() { return [{ tag: "div[data-callout]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0]; },
});
/** Two to four side-by-side columns; each column holds blocks. They stack on a narrow page. */
export const Columns = Node.create({
  name: "columns", group: "block", content: "column{2,4}", isolating: true, defining: true,
  parseHTML() { return [{ tag: "div[data-columns]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-columns": "" }), 0]; },
});
export const Column = Node.create({
  name: "column", content: "block+", isolating: true, defining: true,
  parseHTML() { return [{ tag: "div[data-column]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-column": "" }), 0]; },
});
/** An outline of the page's headings that follows the text as it changes. */
export const TableOfContents = Node.create({
  name: "tableOfContents", group: "block", atom: true, selectable: true, draggable: true,
  addAttributes() { return { sticky: { default: false, parseHTML: (el: HTMLElement) => el.hasAttribute("data-sticky"), renderHTML: (a: { sticky: boolean }) => (a.sticky ? { "data-sticky": "" } : {}) } }; },
  parseHTML() { return [{ tag: "div[data-toc]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-toc": "" })]; },
  addNodeView() { return ReactNodeViewRenderer(TocView); },
});

/** A quote set apart in larger type (the "pull quote"): a blockquote with one extra flag, so it stays a quote in every export. */
export const PullQuote = Blockquote.extend({
  addAttributes() { return { pull: { default: false, parseHTML: (el: HTMLElement) => el.hasAttribute("data-pull"), renderHTML: (a: { pull: boolean }) => (a.pull ? { "data-pull": "" } : {}) } }; },
});
/** A coloured badge on selected text: light (tinted, outlined) or strong (solid). The colour is one of the editor's palette values. */
export const Badge = Mark.create({
  name: "badge", inclusive: false,
  addAttributes() { return { color: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-color"), renderHTML: () => ({}) }, strong: { default: false, parseHTML: (el: HTMLElement) => el.hasAttribute("data-strong"), renderHTML: () => ({}) } }; },
  parseHTML() { return [{ tag: "span[data-badge]" }]; },
  renderHTML({ mark }) {
    const color = String(mark.attrs.color ?? ""), strong = mark.attrs.strong === true;
    return ["span", { "data-badge": "", "data-color": color, ...(strong ? { "data-strong": "" } : {}), style: strong ? `background-color:${color}` : `background-color:color-mix(in srgb, ${color} 22%, transparent);border-color:${color}` }, 0];
  },
});
/** A button-style link to an https address, on its own line. Edited by replacing it. */
export const ButtonBlock = Node.create({
  name: "button", group: "block", atom: true, selectable: true, draggable: true,
  addAttributes() { return { label: { default: "" }, href: { default: "" } }; },
  parseHTML() { return [{ tag: "a[data-button]", getAttrs: (el) => ({ label: (el as HTMLElement).textContent ?? "", href: (el as HTMLElement).getAttribute("href") ?? "" }) }]; },
  renderHTML({ node }) { return ["a", { "data-button": "", href: safeDocHref(node.attrs.href) ?? "", rel: "nofollow noopener noreferrer ugc", target: "_blank" }, String(node.attrs.label)]; },
  renderText({ node }) { return String(node.attrs.label); },
});
/** An @mention of a person, a page of this doc or a task. Text only: it never notifies anyone. */
export const Mention = Node.create({
  name: "mention", group: "inline", inline: true, atom: true, selectable: true,
  addAttributes() { return { kind: { default: "person" }, id: { default: "" }, label: { default: "" } }; },
  parseHTML() { return [{ tag: "span[data-mention]", getAttrs: (el) => ({ kind: (el as HTMLElement).getAttribute("data-kind") ?? "person", id: (el as HTMLElement).getAttribute("data-id") ?? "", label: ((el as HTMLElement).textContent ?? "").replace(/^@/, "") }) }]; },
  renderHTML({ node }) { return ["span", { "data-mention": "", "data-kind": String(node.attrs.kind), "data-id": String(node.attrs.id) }, `@${String(node.attrs.label)}`]; },
  renderText({ node }) { return `@${String(node.attrs.label)}`; },
});

/** Marks the top-level block the cursor is in, so block focus mode can dim the rest. */
export const BlockFocus = Extension.create({
  name: "blockFocus",
  addProseMirrorPlugins() {
    return [new Plugin({ key: new PluginKey("blockFocus"), props: { decorations(state) {
      const { $from } = state.selection; if ($from.depth < 1) return null;
      const pos = $from.before(1), node = state.doc.nodeAt(pos); if (!node) return null;
      return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: "is-current-block" })]);
    } } })];
  },
});

export type EditorLabels = { placeholder: string; summary: string };
/** The Docs editor's extension set: the shared rich-text base (Tiptap StarterKit) plus tables, checklists, toggles, colours, alignment, banners, columns and an outline block. */
export function docExtensions(labels: EditorLabels): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] }, blockquote: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["https"], isAllowedUri: (url) => safeDocHref(url) !== null, HTMLAttributes: { rel: "nofollow noopener noreferrer ugc", target: "_blank" } },
    }),
    TextStyle, Color, Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TaskList, TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
    Details.configure({ persist: true }), DetailsSummary, DetailsContent,
    Callout, Columns, Column, TableOfContents, BlockFocus, PullQuote, Badge, ButtonBlock, Mention,
    Placeholder.configure({ placeholder: ({ node }) => node.type.name === "detailsSummary" ? labels.summary : labels.placeholder, showOnlyCurrent: true, includeChildren: true }),
  ];
}
export type { Editor };
