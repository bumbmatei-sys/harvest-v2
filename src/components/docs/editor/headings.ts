import type { Editor } from "@tiptap/core";

export type Heading = { level: number; text: string; pos: number };
export function headingsOf(editor: Editor | null): Heading[] {
  const out: Heading[] = [];
  editor?.state.doc.descendants((node, pos) => { if (node.type.name === "heading" && node.textContent.trim()) out.push({ level: Number(node.attrs.level) || 1, text: node.textContent.trim(), pos }); });
  return out;
}
export function jumpToHeading(editor: Editor, pos: number) {
  editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
}
