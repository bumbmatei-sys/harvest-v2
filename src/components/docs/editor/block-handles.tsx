"use client";
import { useRef } from "react";
import type { Editor } from "@tiptap/core";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { GripVertical, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

/** The "+" (add a block below, opens the slash menu) and the grip (drag the block to reorder) at the left edge of the block under the pointer. */
export function BlockHandles({ editor }: { editor: Editor }) {
  const t = useTranslations("Docs"), hovered = useRef<{ node: PMNode; pos: number } | null>(null);
  function add() {
    const at = hovered.current ? hovered.current.pos + hovered.current.node.nodeSize : editor.state.doc.content.size;
    editor.chain().focus().insertContentAt(at, { type: "paragraph", content: [{ type: "text", text: "/" }] }).run();
  }
  return <DragHandle editor={editor} onNodeChange={({ node, pos }) => { hovered.current = node ? { node, pos } : null; }}>
    <div className="flex items-center gap-0.5 text-muted-foreground" data-block-handles>
      <button type="button" aria-label={t("addBlock")} className="flex size-7 items-center justify-center rounded-md hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 max-sm:hidden" onMouseDown={(e) => e.preventDefault()} onClick={add}><Plus className="size-4" aria-hidden="true" /></button>
      <span role="img" aria-label={t("dragBlock")} className="flex size-7 cursor-grab items-center justify-center rounded-md hover:bg-accent max-sm:hidden"><GripVertical className="size-4" aria-hidden="true" /></span>
    </div>
  </DragHandle>;
}
