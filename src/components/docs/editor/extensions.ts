import { mergeAttributes, Node, type AnyExtension, type Editor } from "@tiptap/core";
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
  parseHTML() { return [{ tag: "div[data-toc]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-toc": "" })]; },
  addNodeView() { return ReactNodeViewRenderer(TocView); },
});

export type EditorLabels = { placeholder: string; summary: string };
/** The Docs editor's extension set: the shared rich-text base (Tiptap StarterKit) plus tables, checklists, toggles, colours, alignment, banners, columns and an outline block. */
export function docExtensions(labels: EditorLabels): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["https"], isAllowedUri: (url) => safeDocHref(url) !== null, HTMLAttributes: { rel: "nofollow noopener noreferrer ugc", target: "_blank" } },
    }),
    TextStyle, Color, Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TaskList, TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
    Details.configure({ persist: true }), DetailsSummary, DetailsContent,
    Callout, Columns, Column, TableOfContents,
    Placeholder.configure({ placeholder: ({ node }) => node.type.name === "detailsSummary" ? labels.summary : labels.placeholder, showOnlyCurrent: true, includeChildren: true }),
  ];
}
export type { Editor };
