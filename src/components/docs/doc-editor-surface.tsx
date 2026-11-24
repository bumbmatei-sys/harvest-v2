/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): components/ui/custom/tiptap/rich-text-editor.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import "@/components/docs/docs-prose.css";
import { useEffect, useImperativeHandle, useRef, type RefObject } from "react";
import { Selection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { BlockHandles } from "@/components/docs/editor/block-handles";
import { docExtensions } from "@/components/docs/editor/extensions";
import { headingsOf, jumpToHeading, type Heading } from "@/components/docs/editor/headings";
import { SlashCommand, slashLabel } from "@/components/docs/editor/slash-command";
import { EditorToolbar } from "@/components/docs/editor/toolbar";
import { contentStats, type DocContent } from "@/lib/docs";

export type SurfaceHandle = { focusStart: () => void; getContent: () => DocContent; jumpTo: (position: number) => void };
export type SurfaceStats = ReturnType<typeof contentStats>;

/**
 * The only place that knows the editing engine (Tiptap today). The rest of Docs talks to it through these props: the engine's JSON in, a change signal and plain data out
 * (outline, statistics), a handle for the few commands the page needs. Replacing the engine means replacing this component, the folder `editor/`, and the content sanitiser
 * (`engine` and `schema_version` are stored with every page for that day). `theme` is passed for engines that need it; Tiptap follows the shell's colour tokens and ignores it.
 */
export function DocEditorSurface({ content, readOnly, theme, showToolbar, bodyClassName, header, handleRef, onChange, onNewPage, onOutline, onStats }: {
  content: DocContent; readOnly: boolean; theme?: "light" | "dark"; showToolbar: boolean; bodyClassName: string; header?: React.ReactNode; handleRef: RefObject<SurfaceHandle | null>;
  /** Called after every edit with a reader for the current content (read it only when saving). */
  onChange: (read: () => DocContent) => void;
  onNewPage: (child: boolean) => void; onOutline: (items: Heading[]) => void; onStats: (stats: SurfaceStats) => void;
}) {
  const t = useTranslations("Docs");
  // The editor is created once; its callbacks read the newest props through this ref (written after every render, read only from event handlers).
  const latest = useRef({ onChange, onNewPage, onOutline, onStats });
  useEffect(() => { latest.current = { onChange, onNewPage, onOutline, onStats }; });
  const last = useRef({ outline: "", words: -1, characters: -1 });
  const editor = useEditor({
    immediatelyRender: false, editable: !readOnly, content,
    // eslint-disable-next-line react-hooks/refs -- the callbacks run later, from editor events, never during render
    extensions: [...docExtensions({ placeholder: t("placeholder"), summary: t("toggleSummary") }), SlashCommand.configure({ actions: { newPage: (child) => latest.current.onNewPage(child) }, labelOf: (item) => slashLabel(t, item) })],
    editorProps: { attributes: { "aria-label": t("pageContent"), role: "textbox", "aria-multiline": "true", class: "docs-prose", ...(theme ? { "data-theme": theme } : {}) } },
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
  }), [editor, content]);
  return <>
    {editor && showToolbar && <div className="shrink-0 border-b bg-card" data-docs-toolbar-bar><EditorToolbar editor={editor} /></div>}
    <div className="min-h-0 flex-1 overflow-y-auto" data-docs-scroll>
      <div className={bodyClassName}>
        {header}
        <div className="relative mt-6 ps-0 sm:ps-10">
          {editor && !readOnly && <BlockHandles editor={editor} />}
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  </>;
}
