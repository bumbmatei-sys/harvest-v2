import { sanitizeBlogBody } from "../lib/blog";
import { safeDocHref, type DocNode } from "../lib/docs";
import { parseVideoLink } from "../lib/email/video";
import type { ExternalBlogPlatform } from "../lib/external-blog";

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const element = (tag: string, body: string, attributes = "") => `<${tag}${attributes}>${body}</${tag}>`;
const attribute = (name: string, value: string) => ` ${name}="${escape(value)}"`;
const blocks: Record<string, string> = {
  paragraph: "p", bulletList: "ul", orderedList: "ol", listItem: "li", blockquote: "blockquote",
  tableRow: "tr", tableHeader: "th", tableCell: "td", taskList: "ul", taskItem: "li",
};
const marks: Record<string, string> = { bold: "strong", italic: "em", underline: "u", strike: "s", code: "code" };
export type ExternalBlogWarning = "video_link" | "code_block" | "nested_image" | "image_unavailable"
  | "editor_block" | "inline_style" | "wix_block_limit" | "seo_unsupported" | "excerpt_optional" | "featured_image_preserved";

export function exportBlogHtml(raw: unknown, platform: ExternalBlogPlatform, imageUrl: (id: string) => string | null) {
  const warnings = new Set<ExternalBlogWarning>();
  const maxBlock = platform === "wix" ? 30_000 : Infinity;
  const render = (node: DocNode, nestedImage = false): string => {
    const attrs = node.attrs ?? {};
    const inside = nestedImage || ["blockquote", "bulletList", "orderedList", "taskList"].includes(node.type);
    const children = () => (node.content ?? []).map((child) => render(child, inside)).join("");
    if (node.type === "text") {
      let html = escape(node.text ?? "");
      for (const mark of node.marks ?? []) {
        const tag = marks[mark.type];
        const href = mark.type === "link" ? safeDocHref(mark.attrs?.href) : null;
        if (tag) html = element(tag, html);
        else if (href) html = element("a", html, attribute("href", href));
        else warnings.add("inline_style");
      }
      return html;
    }
    if (node.type === "paragraph" && node.content?.length === 1 && node.content[0].type === "text") {
      const child = node.content[0];
      const source = child.marks?.find((m) => m.type === "link")?.attrs?.href ?? child.text;
      const video = typeof source === "string" ? parseVideoLink(source) : null;
      if (video?.kind === "youtube") {
        const url = `https://www.youtube.com/watch?v=${video.id}`;
        if (platform === "wordpress" || platform === "shopify") {
          return element("iframe", "", attribute("src", `https://www.youtube-nocookie.com/embed/${video.id}`) + ' title="Video" loading="lazy" allowfullscreen');
        }
        warnings.add("video_link");
        return element("p", element("a", escape(child.text ?? url), attribute("href", url)));
      }
    }
    if (node.type === "blogImage") {
      if (platform === "wix" && nestedImage) { warnings.add("nested_image"); return ""; }
      const value = imageUrl(String(attrs.fileId));
      const url = value ? URL.parse(value) : null;
      if (!url || url.protocol !== "https:" || url.username || url.password) { warnings.add("image_unavailable"); return ""; }
      return `<img${attribute("src", url.href)}${attribute("alt", String(attrs.alt ?? ""))}>`;
    }
    if (node.type === "heading") return element(`h${attrs.level ?? 2}`, children());
    if (node.type === "horizontalRule") return "<hr>";
    if (node.type === "hardBreak") return "<br>";
    if (node.type === "table") return element("table", element("tbody", children()));
    if (node.type === "codeBlock") {
      if (platform === "webflow") { warnings.add("code_block"); return element("p", children()); }
      return element("pre", element("code", children()));
    }
    if (node.type === "button" || node.type === "mention") {
      warnings.add("editor_block");
      const label = escape(String(attrs.label ?? "")), href = safeDocHref(attrs.href);
      return href ? element("a", label, attribute("href", href)) : label;
    }
    const block = blocks[node.type];
    if (block) {
      let extra = "";
      if (attrs.textAlign || attrs.pull || attrs.colwidth) warnings.add("inline_style");
      for (const name of ["start", "colspan", "rowspan"]) {
        if (typeof attrs[name] === "number") extra += attribute(name, String(attrs[name]));
      }
      if (node.type === "taskList" || node.type === "taskItem") warnings.add("editor_block");
      return element(block, (node.type === "taskItem" && attrs.checked ? "✓ " : "") + children(), extra);
    }
    warnings.add("editor_block");
    return children();
  };
  const bodyHtml = (sanitizeBlogBody(raw).content ?? []).map((node) => render(node)).filter((html) => {
    if (html.length <= maxBlock) return true;
    warnings.add("wix_block_limit");
    return false;
  }).join("");
  return { bodyHtml, warnings: [...warnings] };
}
