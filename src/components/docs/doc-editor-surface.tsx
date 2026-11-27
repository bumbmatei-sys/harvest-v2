/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): components/ui/custom/tiptap/rich-text-editor.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import "@/components/docs/docs-prose.css";
import { useEffect, useImperativeHandle, useRef, type RefObject } from "react";
import { Selection } from "@tiptap/pm/state";
import type { AnyExtension } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { BlockHandles } from "@/components/docs/editor/block-handles";
import { docExtensions } from "@/components/docs/editor/extensions";
import { headingsOf, jumpToHeading, type Heading } from "@/components/docs/editor/headings";
import { SlashCommand, slashLabel } from "@/components/docs/editor/slash-command";
import { MentionCommand, type MentionItem } from "@/components/docs/editor/mention-command";
import type { InsertKind } from "@/components/docs/editor/slash-items";
import { EditorToolbar } from "@/components/docs/editor/toolbar";
import { contentStats, type DocContent } from "@/lib/docs";
import { cn } from "@/lib/utils";

export type SurfaceHandle = { focusStart: () => void; getContent: () => DocContent; jumpTo: (position: number) => void; selectionText: () => string; jumpToText: (text: string) => void; insertBlock: (kind: "table" | "columns" | "checklist") => void; insertContent: (content: unknown) => void; insertLink: (text: string, href: string) => void };
export type { MentionItem, InsertKind };
export type SurfaceStats = ReturnType<typeof contentStats>;

/**
 * The only place that knows the editing engine (Tiptap today). The rest of Docs talks to it through these props: the engine's JSON in, a change signal and plain data out
 * (outline, statistics), a handle for the few commands the page needs. Replacing the engine means replacing this component, the folder `editor/`, and the content sanitiser
 * (`engine` and `schema_version` are stored with every page for that day). `theme` is passed for engines that need it; Tiptap follows the shell's colour tokens and ignores it.
 */
export function DocEditorSurface({ content, readOnly, theme, showToolbar, focusBlock = false, bodyClassName, header, handleRef, onChange, onNewPage, onInsert, mentionSource, onOutline, onStats, extraExtensions = [], slashExclude, mentions = true, label }: {
  content: DocContent; readOnly: boolean; theme?: "light" | "dark"; showToolbar: boolean; focusBlock?: boolean; bodyClassName: string; header?: React.ReactNode; handleRef: RefObject<SurfaceHandle | null>;
  /** Called after every edit with a reader for the current content (read it only when saving). */
  onChange: (read: () => DocContent) => void;
  onNewPage: (child: boolean) => void; onInsert: (kind: InsertKind) => void; mentionSource: (query: string) => Promise<MentionItem[]>; onOutline: (items: Heading[]) => void; onStats: (stats: SurfaceStats) => void;
  /** Other editors (the blog) add their own nodes, drop slash items they have no use for, turn @mentions off and name the text box. Read once, when the editor is created. */
  extraExtensions?: AnyExtension[]; slashExclude?: readonly string[]; mentions?: boolean; label?: string;
}) {
  const t = useTranslations("Docs");
  // The editor is created once; its callbacks read the newest props through this ref (written after every render, read only from event handlers).
  const latest = useRef({ onChange, onNewPage, onInsert, mentionSource, onOutline, onStats });
  useEffect(() => { latest.current = { onChange, onNewPage, onInsert, mentionSource, onOutline, onStats }; });
  const last = useRef({ outline: "", words: -1, characters: -1 });
  const editor = useEditor({
    immediatelyRender: false, editable: !readOnly, content,
    // eslint-disable-next-line react-hooks/refs -- the callbacks run later, from editor events, never during render
    extensions: [...docExtensions({ placeholder: t("placeholder"), summary: t("toggleSummary") }), ...extraExtensions, ...(mentions ? [MentionCommand.configure({ source: (q: string) => latest.current.mentionSource(q) })] : []), SlashCommand.configure({ actions: { newPage: (child) => latest.current.onNewPage(child), insert: (kind) => latest.current.onInsert(kind) }, labelOf: (item) => slashLabel(t, item), exclude: slashExclude })],
    editorProps: { attributes: { "aria-label": label ?? t("pageContent"), role: "textbox", "aria-multiline": "true", class: "docs-prose", ...(theme ? { "data-theme": theme } : {}) } },
    onCreate: ({ editor: e }) => publish(e),
    onUpdate: ({ editor: e }) => { latest.current.onChange(() => e.getJSON() as DocContent); publish(e); },
  });
  function publish(e: NonNullable<typeof editor>) {
    const outline = headingsOf(e), key = JSON.stringify(outline);
    if (key !== last.current.outline) { last.current.outline = key; latest.current.onOutline(outline); }
    const stats = contentStats(e.getJSON() as DocContent);
    if (stats.words !== last.current.words || stats.characters !== last.current.characters) { last.current.words = stats.words; last.current.characters = stats.characters; latest.current.onStats(stats); }
  }
  useEffect(() => { editor?.setEditable(!readOnly, false); }, [editor, readOnly]);
  useImperativeHandle(handleRef, () => ({
    // Synchronous on purpose: Tiptap's own focus command defers to the next frame, so keys typed right after Enter in the title would still land in the title.
    focusStart: () => { if (!editor) return; editor.view.dispatch(editor.state.tr.setSelection(Selection.atStart(editor.state.doc))); editor.view.focus(); },
    getContent: () => (editor?.getJSON() ?? content) as DocContent,
    jumpTo: (position) => { if (editor) jumpToHeading(editor, position); },
    selectionText: () => { if (!editor) return ""; const { from, to } = editor.state.selection; return from === to ? "" : editor.state.doc.textBetween(from, to, " ").trim(); },
    jumpToText: (text) => {
      if (!editor || !text) return;
      let found = -1;
      editor.state.doc.descendants((node, pos) => { if (found < 0 && node.isText && node.text) { const at = node.text.indexOf(text); if (at >= 0) found = pos + at; } return found < 0; });
      if (found >= 0) editor.chain().focus().setTextSelection({ from: found, to: found + text.length }).scrollIntoView().run();
    },
    insertContent: (content) => { editor?.chain().focus().insertContent(content as never).run(); },
    insertLink: (text, href) => { editor?.chain().focus().insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] }).run(); },
    insertBlock: (kind) => {
      if (!editor) return;
      const chain = editor.chain().focus("end");
      if (kind === "table") chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      else if (kind === "columns") chain.insertContent({ type: "columns", content: [{ type: "column", content: [{ type: "paragraph" }] }, { type: "column", content: [{ type: "paragraph" }] }] }).run();
      else chain.toggleTaskList().run();
    },
  }), [editor, content]);
  return <>
    {editor && showToolbar && <div className="shrink-0 border-b bg-card" data-docs-toolbar-bar><EditorToolbar editor={editor} /></div>}
    <div className="min-h-0 flex-1 overflow-y-auto" data-docs-scroll>
      <div className={bodyClassName}>
        {header}
        <div className={cn("relative mt-6 ps-0 sm:ps-10", focusBlock && "docs-focus-block")}>
          {editor && !readOnly && <BlockHandles editor={editor} />}
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  </>;
}
