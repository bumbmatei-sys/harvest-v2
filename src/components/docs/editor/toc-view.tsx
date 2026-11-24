"use client";
import { NodeViewWrapper, type NodeViewProps, useEditorState } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { headingsOf, jumpToHeading } from "@/components/docs/editor/headings";

/** The table-of-contents block: the page's headings as links that move the cursor to the heading. */
export function TocView({ editor }: NodeViewProps) {
  const t = useTranslations("Docs");
  const items = useEditorState({ editor, selector: ({ editor: e }) => headingsOf(e), equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  return <NodeViewWrapper contentEditable={false} data-toc-block className="my-3 rounded-lg border bg-muted/40 p-3">
    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("outline")}</p>
    {items.length === 0 ? <p className="text-sm text-muted-foreground">{t("outlineEmpty")}</p>
      : <ul className="space-y-0.5">{items.map((h) => <li key={h.pos} style={{ paddingInlineStart: `${(h.level - 1) * 0.75}rem` }}>
        <button type="button" className="min-h-11 text-start text-sm underline-offset-2 hover:underline lg:min-h-7" onClick={() => jumpToHeading(editor, h.pos)}>{h.text}</button></li>)}</ul>}
  </NodeViewWrapper>;
}
