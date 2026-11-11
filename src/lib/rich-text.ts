// Shared rich text (Communities PR 4b): Tiptap JSON restricted to a small allow-list. Stored as data and rendered
// by a React renderer, never as HTML. sanitizeRichText returns a clean copy with only allowed attributes, or null.
export type RichMark = { type: "bold" | "italic" | "strike" | "underline" } | { type: "link"; attrs: { href: string } };
export type RichInline = { type: "text"; text: string; marks?: RichMark[] } | { type: "hardBreak" };
export type RichBlock =
  | { type: "paragraph"; content?: RichInline[] }
  | { type: "heading"; attrs: { level: 2 | 3 }; content?: RichInline[] }
  | { type: "bulletList"; content: RichListItem[] }
  | { type: "orderedList"; attrs?: { start: number }; content: RichListItem[] }
  | { type: "blockquote"; content: RichBlock[] };
export type RichListItem = { type: "listItem"; content: RichBlock[] };
export type RichDoc = { type: "doc"; content: RichBlock[] };
export const richTextLimits = { depth: 12, characters: 20000, bytes: 100_000, nodes: 5000 } as const;

const simpleMarks = new Set(["bold", "italic", "strike", "underline"]);
type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

export function safeHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

export function sanitizeRichText(input: unknown): RichDoc | null {
  if (!isObject(input) || input.type !== "doc" || !Array.isArray(input.content) || input.content.length === 0) return null;
  if (JSON.stringify(input).length > richTextLimits.bytes) return null;
  let characters = 0, nodes = 0;
  const fail = Symbol("invalid");
  const count = () => { if (++nodes > richTextLimits.nodes) throw fail; };

  function inline(node: unknown): RichInline {
    count();
    if (!isObject(node)) throw fail;
    if (node.type === "hardBreak") return { type: "hardBreak" };
    if (node.type !== "text" || typeof node.text !== "string" || node.text.length === 0) throw fail;
    characters += node.text.length;
    if (characters > richTextLimits.characters) throw fail;
    if (node.marks === undefined) return { type: "text", text: node.text };
    if (!Array.isArray(node.marks)) throw fail;
    const marks = node.marks.map((mark): RichMark => {
      if (!isObject(mark) || typeof mark.type !== "string") throw fail;
      if (simpleMarks.has(mark.type)) return { type: mark.type as "bold" };
      if (mark.type === "link" && isObject(mark.attrs)) { const href = safeHref(mark.attrs.href); if (href) return { type: "link", attrs: { href } }; }
      throw fail;
    });
    return marks.length ? { type: "text", text: node.text, marks } : { type: "text", text: node.text };
  }
  const inlineContent = (content: unknown) => {
    if (content === undefined) return undefined;
    if (!Array.isArray(content)) throw fail;
    return content.map(inline);
  };
  function block(node: unknown, depth: number): RichBlock {
    count();
    if (depth > richTextLimits.depth || !isObject(node)) throw fail;
    switch (node.type) {
      case "paragraph": { const content = inlineContent(node.content); return content?.length ? { type: "paragraph", content } : { type: "paragraph" }; }
      case "heading": {
        const level = isObject(node.attrs) ? node.attrs.level : undefined;
        if (level !== 2 && level !== 3) throw fail;
        const content = inlineContent(node.content);
        return content?.length ? { type: "heading", attrs: { level }, content } : { type: "heading", attrs: { level } };
      }
      case "bulletList": case "orderedList": {
        if (!Array.isArray(node.content) || node.content.length === 0) throw fail;
        const items = node.content.map((item): RichListItem => {
          count();
          if (!isObject(item) || item.type !== "listItem" || !Array.isArray(item.content) || item.content.length === 0) throw fail;
          return { type: "listItem", content: item.content.map((child) => block(child, depth + 1)) };
        });
        if (node.type === "bulletList") return { type: "bulletList", content: items };
        const start = isObject(node.attrs) ? node.attrs.start : undefined;
        return Number.isInteger(start) && (start as number) > 1 && (start as number) <= 10000
          ? { type: "orderedList", attrs: { start: start as number }, content: items } : { type: "orderedList", content: items };
      }
      case "blockquote":
        if (!Array.isArray(node.content) || node.content.length === 0) throw fail;
        return { type: "blockquote", content: node.content.map((child) => block(child, depth + 1)) };
      default: throw fail;
    }
  }
  try { return { type: "doc", content: input.content.map((child) => block(child, 1)) }; }
  catch (error) { if (error === fail) return null; throw error; }
}

/** Plain text of a sanitized document: one line per paragraph, heading or list item. */
export function plainText(doc: RichDoc): string {
  const lines: string[] = [];
  const inline = (content?: RichInline[]) => (content ?? []).map((n) => n.type === "text" ? n.text : "\n").join("");
  const walk = (blocks: RichBlock[]) => {
    for (const b of blocks) {
      if (b.type === "paragraph" || b.type === "heading") lines.push(inline(b.content));
      else if (b.type === "blockquote") walk(b.content);
      else for (const item of b.content) walk(item.content);
    }
  };
  walk(doc.content);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
