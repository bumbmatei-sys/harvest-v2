import { message } from "../../i18n/messages";
import { sanitizeRichText, type RichBlock, type RichDoc, type RichInline } from "../../lib/rich-text";

function httpsUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(message("Errors.checkTheSuppliedDetails"));
  return url.href;
}

export function newsletterContent(value: unknown): RichDoc | null {
  const doc = sanitizeRichText(value);
  if (!doc) return null;
  try {
    renderBlocks(doc);
    return doc;
  } catch {
    return null;
  }
}

const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (value: string) => value.replace(/[&<>"']/g, character => entities[character]);
const tags = { bold: "strong", italic: "em", strike: "s", underline: "u" };

function renderBlocks(doc: RichDoc) {
  const links = new Map<number, string>();
  function inline(node: RichInline) {
    if (node.type === "hardBreak") return { html: "<br>", text: "\n" };
    let html = escape(node.text);
    let href: string | undefined;
    for (const mark of node.marks ?? []) {
      if (mark.type === "link") {
        if (href) throw new Error(message("Errors.checkTheSuppliedDetails"));
        href = httpsUrl(mark.attrs.href);
      } else {
        const tag = tags[mark.type];
        html = `<${tag}>${html}</${tag}>`;
      }
    }
    if (!href) return { html, text: node.text };
    const id = links.size + 1;
    links.set(id, href);
    return { html: `<a href="${escape(href)}" data-newsletter-link="${id}">${html}</a>`, text: `${node.text} (${href})` };
  }
  function block(node: RichBlock): { html: string; text: string } {
    if (node.type === "blockquote") {
      const nested = node.content.map(block);
      return { html: `<blockquote>${nested.map(value => value.html).join("")}</blockquote>`, text: nested.map(value => value.text).join("\n") };
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      const ordered = node.type === "orderedList";
      const tag = ordered ? "ol" : "ul";
      const start = ordered ? node.attrs?.start ?? 1 : 1;
      const items = node.content.map(item => item.content.map(block));
      return {
        html: `<${tag}${start > 1 ? ` start="${start}"` : ""}>${items.map(item => `<li>${item.map(value => value.html).join("")}</li>`).join("")}</${tag}>`,
        text: items.map((item, index) => `${ordered ? `${start + index}.` : "-"} ${item.map(value => value.text).join("\n")}`).join("\n"),
      };
    }
    const tag = node.type === "heading" ? `h${node.attrs.level}` : "p";
    const parts = (node.content ?? []).map(inline);
    return { html: `<${tag}>${parts.map(value => value.html).join("")}</${tag}>`, text: parts.map(value => value.text).join("") };
  }
  const blocks = doc.content.map(block);
  if (links.size > 5000) throw new Error(message("Errors.checkTheSuppliedDetails"));
  return { html: blocks.map(value => value.html).join(""), text: blocks.map(value => value.text).join("\n\n"), links };
}

export function newsletterLinkCount(doc: RichDoc) {
  return renderBlocks(doc).links.size;
}

export type NewsletterFooter = { name: string; email: string; postalAddress: string; unsubscribe: string };
export function renderNewsletter(value: unknown, footer: NewsletterFooter) {
  const doc = sanitizeRichText(value);
  if (!doc) throw new Error(message("Errors.checkTheSuppliedDetails"));
  const body = renderBlocks(doc);
  const unsubscribe = httpsUrl(footer.unsubscribe);
  return {
    links: body.links,
    html: `<!doctype html><html><body>${body.html}<footer><hr><p>${escape(footer.name)}<br>${escape(footer.postalAddress)}<br>${escape(footer.email)}</p><p><a href="${escape(unsubscribe)}">Unsubscribe</a></p></footer></body></html>`,
    text: `${body.text}\n\n${footer.name}\n${footer.postalAddress}\n${footer.email}\nUnsubscribe: ${unsubscribe}`,
  };
}
