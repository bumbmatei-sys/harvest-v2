// Conversions between doc content and portable formats. Pure (no database); used by the export and import routes and by the print and public views.
import { parseDocument } from "htmlparser2";
import { marked } from "marked";
import type { ChildNode, Element } from "domhandler";
import { docHighlightColors } from "./theme-registry";
import { docText, safeDocHref, type DocContent, type DocNode } from "./docs";

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const hex = /^#[0-9a-f]{6}$/i;
const alignStyle = (node: DocNode) => { const a = node.attrs?.textAlign; return a === "center" || a === "right" || a === "justify" ? ` style="text-align:${a}"` : ""; };

// ---- HTML ---------------------------------------------------------------------------------------------------------------------------------------------------
function inlineHtml(node: DocNode): string {
  if (node.type === "hardBreak") return "<br>";
  let out = esc(node.text ?? "");
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") out = `<strong>${out}</strong>`;
    else if (mark.type === "italic") out = `<em>${out}</em>`;
    else if (mark.type === "underline") out = `<u>${out}</u>`;
    else if (mark.type === "strike") out = `<s>${out}</s>`;
    else if (mark.type === "code") out = `<code>${out}</code>`;
    else if (mark.type === "link") { const href = safeDocHref(mark.attrs?.href); if (href) out = `<a href="${esc(href)}" rel="nofollow noopener noreferrer ugc">${out}</a>`; }
    else if (mark.type === "textStyle" && typeof mark.attrs?.color === "string" && hex.test(mark.attrs.color)) out = `<span style="color:${mark.attrs.color}">${out}</span>`;
    else if (mark.type === "badge" && typeof mark.attrs?.color === "string" && hex.test(mark.attrs.color)) out = mark.attrs.strong === true ? `<span data-badge style="background-color:${mark.attrs.color};color:black;border-radius:4px;padding:0 4px">${out}</span>` : `<span data-badge style="border:1px solid ${mark.attrs.color};border-radius:4px;padding:0 4px">${out}</span>`;
    else if (mark.type === "highlight" && typeof mark.attrs?.color === "string" && hex.test(mark.attrs.color)) out = `<mark style="background-color:${mark.attrs.color};color:black">${out}</mark>`;
  }
  return out;
}
const kids = (node: DocNode, fn: (child: DocNode) => string) => (node.content ?? []).map(fn).join("");
/** Safe HTML for a doc node: every text is escaped, links are https only, colours are validated hex, no attribute is passed through. */
export type HtmlOptions = { /** Address of an inline picture (the blog's `blogImage` node); without it pictures are left out. */ image?: (fileId: string) => string | null };
export function nodeToHtml(node: DocNode, options: HtmlOptions = {}): string {
  const sub = (child: DocNode) => nodeToHtml(child, options);
  switch (node.type) {
    case "text": case "hardBreak": return inlineHtml(node);
    case "mention": return `<span data-mention>@${esc(String(node.attrs?.label ?? ""))}</span>`;
    case "button": { const href = safeDocHref(node.attrs?.href); return href ? `<p><a data-button href="${esc(href)}" rel="nofollow noopener noreferrer ugc">${esc(String(node.attrs?.label ?? ""))}</a></p>` : ""; }
    case "paragraph": return `<p${alignStyle(node)}>${kids(node, sub)}</p>`;
    case "heading": { const l = Math.min(4, Math.max(1, Number(node.attrs?.level) || 1)); return `<h${l}${alignStyle(node)}>${kids(node, sub)}</h${l}>`; }
    case "bulletList": return `<ul>${kids(node, sub)}</ul>`;
    case "orderedList": return `<ol>${kids(node, sub)}</ol>`;
    case "listItem": return `<li>${kids(node, sub)}</li>`;
    case "taskList": return `<ul data-type="taskList">${kids(node, sub)}</ul>`;
    case "taskItem": return `<li data-type="taskItem" data-checked="${node.attrs?.checked === true}">${node.attrs?.checked === true ? "☑ " : "☐ "}${kids(node, sub)}</li>`;
    case "blockquote": return `<blockquote${node.attrs?.pull === true ? " data-pull" : ""}>${kids(node, sub)}</blockquote>`;
    case "codeBlock": return `<pre><code>${esc(docText(node))}</code></pre>`;
    case "horizontalRule": return "<hr>";
    case "table": return `<table>${kids(node, sub)}</table>`;
    case "tableRow": return `<tr>${kids(node, sub)}</tr>`;
    case "tableHeader": return `<th>${kids(node, sub)}</th>`;
    case "tableCell": return `<td>${kids(node, sub)}</td>`;
    case "details": return `<details${node.attrs?.open === true ? " open" : ""}>${kids(node, sub)}</details>`;
    case "detailsSummary": return `<summary>${kids(node, sub)}</summary>`;
    case "detailsContent": return `<div>${kids(node, sub)}</div>`;
    case "callout": return `<div data-callout data-tone="${["info", "success", "warning", "danger"].includes(String(node.attrs?.tone)) ? node.attrs?.tone : "info"}" style="border-left:4px solid gray;padding:4px 12px">${kids(node, sub)}</div>`;
    case "columns": return `<div data-columns>${kids(node, sub)}</div>`;
    case "column": return `<div data-column>${kids(node, sub)}</div>`;
    case "blogImage": { const src = typeof node.attrs?.fileId === "string" ? options.image?.(node.attrs.fileId) : null; return src ? `<figure><img src="${esc(src)}" alt="${esc(String(node.attrs?.alt ?? ""))}" loading="lazy" decoding="async"></figure>` : ""; }
    default: return "";
  }
}
export const docToHtml = (doc: DocContent, options: HtmlOptions = {}) => (doc.content ?? []).map((node) => nodeToHtml(node, options)).join("\n");

// ---- Markdown -----------------------------------------------------------------------------------------------------------------------------------------------
function inlineMd(node: DocNode): string {
  if (node.type === "hardBreak") return "  \n";
  if (node.type === "mention") return `@${String(node.attrs?.label ?? "")}`;
  let out = (node.text ?? "").replace(/([\\`*_{}[\]()#+!|~<>])/g, "\\$1");
  for (const mark of node.marks ?? []) {
    if (mark.type === "code") out = `\`${(node.text ?? "").replace(/`/g, "'")}\``;
    else if (mark.type === "bold") out = `**${out}**`;
    else if (mark.type === "italic") out = `*${out}*`;
    else if (mark.type === "strike") out = `~~${out}~~`;
    else if (mark.type === "underline") out = `<u>${out}</u>`;
    else if (mark.type === "link") { const href = safeDocHref(mark.attrs?.href); if (href) out = `[${out}](${href.replace(/[()]/g, encodeURIComponent)})`; }
  }
  return out;
}
const inlineOf = (node: DocNode) => (node.content ?? []).map(inlineMd).join("");
function blockMd(node: DocNode, depth = 0): string {
  const pad = "  ".repeat(depth);
  const children = () => (node.content ?? []).map((c) => blockMd(c, depth)).filter(Boolean).join("\n\n");
  switch (node.type) {
    case "paragraph": return inlineOf(node);
    case "button": { const href = safeDocHref(node.attrs?.href); return href ? `[${String(node.attrs?.label ?? "").replace(/[\[\]]/g, "")}](${href.replace(/[()]/g, encodeURIComponent)})` : ""; }
    case "heading": return `${"#".repeat(Math.min(4, Math.max(1, Number(node.attrs?.level) || 1)))} ${inlineOf(node)}`;
    case "bulletList": case "taskList": case "orderedList": return (node.content ?? []).map((item, i) => {
      const [first, ...rest] = item.content ?? [];
      const marker = node.type === "orderedList" ? `${(Number(node.attrs?.start) || 1) + i}. ` : node.type === "taskList" ? `- [${item.attrs?.checked === true ? "x" : " "}] ` : "- ";
      const head = first ? blockMd(first, depth + 1) : "";
      const more = rest.map((r) => (r.type === "bulletList" || r.type === "orderedList" || r.type === "taskList" ? "\n" : "\n\n") + blockMd(r, depth + 1).split("\n").map((l) => (l ? "  " + l : l)).join("\n")).join("");
      return `${pad}${marker}${head}${more}`;
    }).join("\n");
    case "blockquote": return children().split("\n").map((l) => `> ${l}`).join("\n");
    case "callout": return children().split("\n").map((l) => `> ${l}`).join("\n");
    case "codeBlock": return "```\n" + docText(node).replace(/```/g, "'''") + "\n```";
    case "horizontalRule": return "---";
    case "table": {
      const rows = (node.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => inlineOf(p)).join(" ").replace(/\|/g, "\\|").replace(/\n/g, " ")));
      if (!rows.length) return "";
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      return [line(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
    }
    case "details": return (node.content ?? []).map((c) => c.type === "detailsSummary" ? `**${inlineOf(c)}**` : blockMd(c, depth)).join("\n\n");
    case "detailsContent": case "columns": case "column": return children();
    default: return "";
  }
}
export const docToMarkdown = (doc: DocContent) => (doc.content ?? []).map((n) => blockMd(n)).filter((s) => s !== "").join("\n\n") + "\n";

// ---- Import: HTML (and Markdown through HTML) to doc content ------------------------------------------------------------------------------------------------
export const importLimits = { chars: 1_000_000 } as const;
type Marks = NonNullable<DocNode["marks"]>;
const attr = (el: Element, name: string) => el.attribs?.[name];
const findBox = (el: Element): Element | undefined => { for (const c of el.children) { if (!isEl(c)) continue; if (c.name.toLowerCase() === "input" && attr(c, "type") === "checkbox") return c; const d = findBox(c); if (d) return d; } return undefined; };
const isEl = (n: ChildNode): n is Element => n.type === "tag" || n.type === "script" || n.type === "style";
const textOf = (n: ChildNode): string => n.type === "text" ? (n as unknown as { data: string }).data : isEl(n) ? n.children.map(textOf).join("") : "";
const skip = new Set(["script", "style", "head", "title", "iframe", "object", "embed", "svg", "img", "video", "audio", "canvas", "form", "input", "button", "select", "textarea", "noscript"]);
const blockTags = new Set(["p", "div", "section", "article", "main", "header", "footer", "aside", "nav", "ul", "ol", "li", "blockquote", "pre", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "details", "summary", "figure", "figcaption", "dl", "dt", "dd"]);

function inline(nodes: ChildNode[], marks: Marks, out: DocNode[], pre = false) {
  for (const n of nodes) {
    if (n.type === "text") {
      let t = (n as unknown as { data: string }).data;
      if (!pre) t = t.replace(/\s+/g, " ");
      if (t) out.push({ type: "text", text: t.slice(0, 20_000), ...(marks.length ? { marks: [...marks] } : {}) });
    } else if (isEl(n)) {
      const tag = n.name.toLowerCase();
      if (skip.has(tag)) continue;
      if (tag === "br") { out.push({ type: "hardBreak" }); continue; }
      const next = [...marks];
      if (tag === "strong" || tag === "b") next.push({ type: "bold" });
      else if (tag === "em" || tag === "i") next.push({ type: "italic" });
      else if (tag === "u") next.push({ type: "underline" });
      else if (tag === "s" || tag === "strike" || tag === "del") next.push({ type: "strike" });
      else if (tag === "code") next.push({ type: "code" });
      else if (tag === "mark") next.push({ type: "highlight", attrs: { color: docHighlightColors[2] } });
      else if (tag === "a") { const href = safeDocHref(attr(n, "href")); if (href) next.push({ type: "link", attrs: { href } }); }
      else if (tag === "span") { const m = /(?:^|;)\s*color\s*:\s*(#[0-9a-f]{6})\b/i.exec(attr(n, "style") ?? ""); if (m) next.push({ type: "textStyle", attrs: { color: m[1].toLowerCase() } }); }
      inline(n.children, next, out, pre);
    }
  }
}
const trimRuns = (runs: DocNode[]) => {
  const out = [...runs];
  while (out.length && out[0].type === "text" && !out[0].text!.trim()) out.shift();
  while (out.length && out[out.length - 1].type === "text" && !out[out.length - 1].text!.trim()) out.pop();
  if (out[0]?.type === "text") out[0] = { ...out[0], text: out[0].text!.replace(/^\s+/, "") };
  const last = out.length - 1;
  if (last >= 0 && out[last].type === "text") out[last] = { ...out[last], text: out[last].text!.replace(/\s+$/, "") };
  return out.filter((r) => r.type !== "text" || r.text);
};
function blocks(nodes: ChildNode[]): DocNode[] {
  const out: DocNode[] = []; let run: ChildNode[] = [];
  const flush = () => { if (!run.length) return; const runs: DocNode[] = []; inline(run, [], runs); const t = trimRuns(runs); if (t.length) out.push({ type: "paragraph", content: t }); run = []; };
  for (const n of nodes) {
    if (n.type === "text") { run.push(n); continue; }
    if (!isEl(n)) continue;
    const tag = n.name.toLowerCase();
    if (skip.has(tag)) continue;
    if (!blockTags.has(tag)) { run.push(n); continue; }
    flush();
    if (/^h[1-6]$/.test(tag)) { const runs: DocNode[] = []; inline(n.children, [], runs); const t = trimRuns(runs); out.push({ type: "heading", attrs: { level: Math.min(4, Number(tag[1])) }, ...(t.length ? { content: t } : {}) }); }
    else if (tag === "p") { const runs: DocNode[] = []; inline(n.children, [], runs); const t = trimRuns(runs); out.push(t.length ? { type: "paragraph", content: t } : { type: "paragraph" }); }
    else if (tag === "hr") out.push({ type: "horizontalRule" });
    else if (tag === "pre") out.push({ type: "codeBlock", ...(textOf(n).trim() ? { content: [{ type: "text", text: textOf(n).replace(/\n$/, "").slice(0, 20_000) }] } : {}) });
    else if (tag === "blockquote") { const c = blocks(n.children); out.push({ type: "blockquote", content: c.length ? c : [{ type: "paragraph" }] }); }
    else if (tag === "ul" || tag === "ol") {
      const items = n.children.filter((c): c is Element => isEl(c) && c.name.toLowerCase() === "li");
      const tasks = attr(n, "data-type") === "taskList" || items.some((li) => /^\s*\[[ xX]\]\s/.test(textOf(li)) || attr(li, "data-type") === "taskItem" || findBox(li));
      const make = (li: Element): DocNode => {
        let checked = attr(li, "data-checked") === "true"; const kidsNodes = li.children;
        const box = findBox(li);
        if (box) checked = "checked" in box.attribs;
        const first = textOf(li).trimStart();
        if (tasks && /^\[[ xX]\]\s/.test(first)) checked = /^\[[xX]\]/.test(first);
        const c = blocks(kidsNodes);
        const stripped = c.map((b, i) => i === 0 && b.type === "paragraph" && b.content?.[0]?.type === "text" ? { ...b, content: [{ ...b.content[0], text: b.content[0].text!.replace(/^(\[[ xX]\]|☐|☑)\s*/, "") }, ...b.content.slice(1)].filter((r) => r.type !== "text" || r.text) } : b);
        return tasks ? { type: "taskItem", attrs: { checked }, content: stripped.length ? stripped : [{ type: "paragraph" }] } : { type: "listItem", content: stripped.length ? stripped : [{ type: "paragraph" }] };
      };
      if (items.length) out.push({ type: tasks ? "taskList" : tag === "ol" ? "orderedList" : "bulletList", content: items.map(make) });
    }
    else if (tag === "table") {
      const rows: Element[] = []; const collect = (el: Element) => { for (const c of el.children) if (isEl(c)) { const t = c.name.toLowerCase(); if (t === "tr") rows.push(c); else if (["thead", "tbody", "tfoot"].includes(t)) collect(c); } };
      collect(n);
      const width = Math.min(20, Math.max(0, ...rows.map((r) => r.children.filter((c) => isEl(c) && ["td", "th"].includes(c.name.toLowerCase())).length)));
      if (rows.length && width) out.push({ type: "table", content: rows.slice(0, 200).map((r) => ({ type: "tableRow", content: Array.from({ length: width }, (_, i) => {
        const cell = r.children.filter((c): c is Element => isEl(c) && ["td", "th"].includes(c.name.toLowerCase()))[i];
        const c = cell ? blocks(cell.children) : [];
        return { type: cell && cell.name.toLowerCase() === "th" ? "tableHeader" : "tableCell", content: c.length ? c : [{ type: "paragraph" }] };
      }) })) });
    }
    else if (tag === "table" || tag === "tr" || tag === "td" || tag === "th" || tag === "thead" || tag === "tbody") out.push(...blocks(n.children));
    else out.push(...blocks(n.children)); // div, section, li outside a list, figure, details and the like: their content, as blocks
  }
  flush();
  return out;
}
/** Parses HTML into doc content (unknown tags lose their markup but keep their text; scripts, styles, images, forms and frames are dropped). The result still goes through the sanitiser. */
export function htmlToBlocks(html: string): DocNode[] {
  if (html.length > importLimits.chars) throw new Error("IMPORT_TOO_LARGE");
  const dom = parseDocument(html);
  const body = dom.children.find((c): c is Element => isEl(c) && c.name.toLowerCase() === "html");
  const bodyEl = body?.children.find((c): c is Element => isEl(c) && c.name.toLowerCase() === "body");
  const out = blocks(bodyEl ? bodyEl.children : body ? body.children : dom.children);
  return out.length ? out : [{ type: "paragraph" }];
}
export function markdownToBlocks(markdown: string): DocNode[] {
  if (markdown.length > importLimits.chars) throw new Error("IMPORT_TOO_LARGE");
  return htmlToBlocks(marked.parse(markdown, { async: false, gfm: true }) as string);
}
export type ImportedPage = { title: string; content: DocContent };
/** One page, or (split) one page per top-level heading: the heading becomes the page title, the blocks up to the next heading its text. Text before the first heading becomes the first page. */
export function splitBlocks(blocksIn: DocNode[], split: boolean, fallbackTitle: string): ImportedPage[] {
  const heading = (b: DocNode) => b.type === "heading" && b.attrs?.level === 1;
  if (!split || !blocksIn.some(heading)) {
    const first = blocksIn.find(heading);
    return [{ title: first ? docText(first).trim().slice(0, 200) : fallbackTitle, content: { type: "doc", content: blocksIn.length ? blocksIn : [{ type: "paragraph" }] } }];
  }
  const pages: ImportedPage[] = []; let current: ImportedPage | null = null;
  for (const b of blocksIn) {
    if (heading(b)) { current = { title: docText(b).trim().slice(0, 200), content: { type: "doc", content: [] } }; pages.push(current); }
    else if (current) current.content.content!.push(b);
    else { current = { title: fallbackTitle, content: { type: "doc", content: [b] } }; pages.push(current); }
  }
  return pages.map((p) => ({ ...p, content: { type: "doc", content: p.content.content!.length ? p.content.content : [{ type: "paragraph" }] } }));
}
