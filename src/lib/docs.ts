// Pure Docs rules shared by the server and the editor: content shape, sanitiser, page styles, stats, tree helpers. No imports from the server or the database.
import { z } from "zod";
import { docHighlightColors, docTextColors } from "./theme-registry";

export type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; marks?: { type: string; attrs?: Record<string, unknown> }[]; text?: string };
export type DocContent = { type: "doc"; content?: DocNode[] };

export const docLimits = { contentBytes: 512 * 1024, depth: 24, nodes: 20_000, text: 20_000, folderName: 80, title: 200, folderDepth: 8, pageDepth: 6, pagesPerDoc: 200, docsPerMinistry: 5_000, foldersPerMinistry: 1_000 } as const;
export const emptyContent = (): DocContent => ({ type: "doc", content: [{ type: "paragraph" }] });

/** Colours the editor offers (defined with the other colour values in theme-registry.ts). */
export const docColors = docTextColors, docHighlights = docHighlightColors;
export const calloutTones = ["info", "success", "warning", "danger"] as const;
export const textAligns = ["left", "center", "right", "justify"] as const;
const hex = /^#[0-9a-fA-F]{6}$/;

export class DocContentError extends Error { constructor(public reason: "TYPE" | "SIZE" | "DEPTH" | "SHAPE") { super("DOC_CONTENT_REFUSED"); } }

/** The safe https address of a link, or null. Credentials in the address, other schemes and malformed values are refused. */
export function safeDocHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try { const url = new URL(value.trim()); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; } catch { return null; }
}

const int = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
function pick(attrs: Record<string, unknown> | undefined, rules: Record<string, (value: unknown) => unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(rules)) { const v = rule(attrs?.[key]); if (v !== undefined) out[key] = v; }
  return Object.keys(out).length ? out : undefined;
}
const oneOf = <T extends string>(list: readonly T[]) => (v: unknown) => (list as readonly unknown[]).includes(v) ? v : undefined;
const bool = (v: unknown) => typeof v === "boolean" ? v : undefined;
const align = { textAlign: oneOf(textAligns) };
const cell = { colspan: (v: unknown) => int(v, 1, 20), rowspan: (v: unknown) => int(v, 1, 200), colwidth: (v: unknown) => Array.isArray(v) && v.length <= 20 && v.every((n) => int(n, 20, 2000) !== undefined) ? v : undefined };
const nodeAttrs: Record<string, Record<string, (value: unknown) => unknown>> = {
  doc: {}, paragraph: align, heading: { level: (v) => int(v, 1, 4), ...align }, bulletList: {}, orderedList: { start: (v) => int(v, 1, 100_000) }, listItem: {},
  taskList: {}, taskItem: { checked: bool }, blockquote: {}, codeBlock: { language: (v) => typeof v === "string" && /^[a-z0-9+#-]{1,20}$/i.test(v) ? v : undefined }, horizontalRule: {}, hardBreak: {},
  text: {}, table: {}, tableRow: {}, tableCell: cell, tableHeader: cell, details: { open: bool }, detailsSummary: {}, detailsContent: {},
  callout: { tone: oneOf(calloutTones) }, columns: {}, column: {}, tableOfContents: {},
};
const markAttrs: Record<string, Record<string, (value: unknown) => unknown>> = {
  bold: {}, italic: {}, underline: {}, strike: {}, code: {}, link: {}, textStyle: { color: (v) => typeof v === "string" && hex.test(v) ? v.toLowerCase() : undefined }, highlight: { color: (v) => typeof v === "string" && hex.test(v) ? v.toLowerCase() : undefined },
};

/**
 * Sanitises Tiptap JSON: only the node and mark types the editor can produce, only allow-listed attributes, https-only links, hex colours, hard size limits.
 * An unknown node or mark type is refused (never silently kept); an unsafe link is dropped but its text stays. Throws {@link DocContentError}.
 */
export function sanitizeDocContent(input: unknown): DocContent {
  let size = 0;
  try { size = new TextEncoder().encode(JSON.stringify(input)).length; } catch { throw new DocContentError("SHAPE"); }
  if (size > docLimits.contentBytes) throw new DocContentError("SIZE");
  if (!input || typeof input !== "object" || (input as DocNode).type !== "doc") throw new DocContentError("SHAPE");
  let nodes = 0;
  const clean = (raw: unknown, depth: number): DocNode => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DocContentError("SHAPE");
    const node = raw as DocNode;
    if (++nodes > docLimits.nodes) throw new DocContentError("SIZE");
    if (depth > docLimits.depth) throw new DocContentError("DEPTH");
    if (typeof node.type !== "string" || !Object.hasOwn(nodeAttrs, node.type)) throw new DocContentError("TYPE");
    const out: DocNode = { type: node.type };
    const attrs = pick(node.attrs, nodeAttrs[node.type]); if (attrs) out.attrs = attrs;
    if (node.type === "text") {
      if (typeof node.text !== "string" || node.text.length === 0 || node.text.length > docLimits.text) throw new DocContentError("SHAPE");
      out.text = node.text;
      if (node.marks !== undefined) {
        if (!Array.isArray(node.marks) || node.marks.length > 12) throw new DocContentError("SHAPE");
        const marks: NonNullable<DocNode["marks"]> = [];
        for (const mark of node.marks) {
          if (!mark || typeof mark.type !== "string" || !Object.hasOwn(markAttrs, mark.type)) throw new DocContentError("TYPE");
          if (mark.type === "link") { const href = safeDocHref(mark.attrs?.href); if (href) marks.push({ type: "link", attrs: { href } }); continue; }
          const a = pick(mark.attrs, markAttrs[mark.type]);
          if ((mark.type === "textStyle" || mark.type === "highlight") && !a) continue;
          marks.push(a ? { type: mark.type, attrs: a } : { type: mark.type });
        }
        if (marks.length) out.marks = marks;
      }
      return out;
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new DocContentError("SHAPE");
      out.content = node.content.map((child) => clean(child, depth + 1));
    }
    return out;
  };
  return clean(input, 0) as DocContent;
}

// Page styles (stored per page). Sparse: only values that differ from the defaults are kept.
export const pageFonts = ["sans", "serif", "mono"] as const, pageSizes = ["small", "default", "large"] as const, pageWidths = ["default", "wide", "full"] as const;
export const pageStyleSchema = z.object({
  font: z.enum(pageFonts).optional(), size: z.enum(pageSizes).optional(), width: z.enum(pageWidths).optional(),
  header: z.object({ icon: z.boolean().optional(), owner: z.boolean().optional(), updated: z.boolean().optional() }).strict().optional(),
  sections: z.object({ subpages: z.boolean().optional(), outline: z.boolean().optional() }).strict().optional(),
}).strict();
export type PageStyle = z.infer<typeof pageStyleSchema>;
export type ResolvedPageStyle = { font: (typeof pageFonts)[number]; size: (typeof pageSizes)[number]; width: (typeof pageWidths)[number]; header: { icon: boolean; owner: boolean; updated: boolean }; sections: { subpages: boolean; outline: boolean } };
export function resolvePageStyle(style: PageStyle | null | undefined): ResolvedPageStyle {
  return { font: style?.font ?? "sans", size: style?.size ?? "default", width: style?.width ?? "default",
    header: { icon: style?.header?.icon ?? true, owner: style?.header?.owner ?? true, updated: style?.header?.updated ?? true },
    sections: { subpages: style?.sections?.subpages ?? false, outline: style?.sections?.outline ?? false } };
}

// Names.
export const folderNameSchema = z.string().trim().min(1).max(docLimits.folderName);
export const docTitleSchema = z.string().trim().max(docLimits.title);
export const pageTitleSchema = z.string().trim().max(docLimits.title);
/** The key two folder names compare by: case and surrounding whitespace do not make a different name. */
export const folderNameKey = (name: string) => name.trim().toLocaleLowerCase("en");

// Text statistics and outline, computed from the JSON so the editor and tests share one rule.
export function docText(node: DocNode | DocContent | null | undefined): string {
  if (!node) return "";
  if ((node as DocNode).text) return (node as DocNode).text!;
  const children = (node.content ?? []) as DocNode[];
  const block = (type: string) => ["paragraph", "heading", "listItem", "taskItem", "tableCell", "tableHeader", "detailsSummary", "codeBlock", "blockquote", "callout", "tableRow"].includes(type);
  return children.map((child) => docText(child) + (block(child.type) ? "\n" : "")).join("");
}
export function contentStats(content: DocContent | null | undefined) {
  const text = docText(content), words = text.split(/\s+/).filter(Boolean).length;
  return { words, characters: text.replace(/\s/g, "").length, readingMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / 200)) };
}
export type OutlineItem = { level: number; text: string };
export function docOutline(content: DocContent | null | undefined): OutlineItem[] {
  const out: OutlineItem[] = [];
  const walk = (node: DocNode) => { if (node.type === "heading") { const text = docText(node).trim(); if (text) out.push({ level: Number(node.attrs?.level) || 1, text }); } node.content?.forEach(walk); };
  (content?.content ?? []).forEach(walk);
  return out;
}

// Page tree.
export type TreePage = { id: string; parentId: string | null; position: number; title: string; icon: string | null; archivedAt: string | null; protected: boolean };
export type PageTreeNode = TreePage & { depth: number; children: PageTreeNode[] };
export function buildPageTree(pages: readonly TreePage[]): PageTreeNode[] {
  const byParent = new Map<string | null, TreePage[]>();
  for (const page of pages) { const list = byParent.get(page.parentId) ?? []; list.push(page); byParent.set(page.parentId, list); }
  const grow = (parent: string | null, depth: number): PageTreeNode[] => (byParent.get(parent) ?? []).slice().sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map((p) => ({ ...p, depth, children: grow(p.id, depth + 1) }));
  const ids = new Set(pages.map((p) => p.id));
  // A page whose parent is missing (archived above it) is shown at the top so it is never lost.
  const roots = grow(null, 0);
  const orphans = pages.filter((p) => p.parentId && !ids.has(p.parentId)).map((p) => ({ ...p, depth: 0, children: grow(p.id, 1) }));
  return [...roots, ...orphans];
}
export const flattenTree = (nodes: readonly PageTreeNode[]): PageTreeNode[] => nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
/** Ids of a page and everything below it. */
export function subtreeIds(pages: readonly { id: string; parentId: string | null }[], id: string): string[] {
  const out = [id]; const kids = (p: string) => pages.filter((x) => x.parentId === p).map((x) => x.id);
  for (let i = 0; i < out.length; i++) out.push(...kids(out[i]));
  return out;
}
/** Moves `id` to `index` among `ids` (the dense sibling order). Out-of-range indexes clamp. */
export function reorder(ids: readonly string[], id: string, index: number): string[] {
  const rest = ids.filter((x) => x !== id), at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

// Roles (the server rules, shared with the interface so a control is not offered that the server would refuse).
export type DocRights = { manage: boolean; write: boolean };
/** Owners and admins manage every doc; members create docs and edit the docs they own; viewers read. */
export const docRights = (role: string, ownerId: string, userId: string): DocRights => ({ manage: role === "owner" || role === "admin", write: role === "owner" || role === "admin" || (role === "member" && ownerId === userId) });
