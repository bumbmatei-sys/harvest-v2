import { z } from "zod";
import { message } from "../i18n/messages";
import { emailDocumentSchema, isEmailDocument, type EmailDocument } from "./email/blocks";
import { renderEmail } from "./email/render";
import { sanitizeRichText, type RichBlock, type RichDoc, type RichInline } from "./rich-text";

export function newsletterHttps(value: string) {
  if (value.length > 2000 || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function safeBlocks(blocks: RichBlock[]): boolean {
  return blocks.every(block => {
    if (block.type === "paragraph" || block.type === "heading") {
      return (block.content ?? []).every(node => node.type !== "text" || (node.marks ?? []).every(mark =>
        mark.type === "bold" || mark.type === "italic" || (mark.type === "link" && newsletterHttps(mark.attrs.href))));
    }
    if (block.type === "blockquote") return safeBlocks(block.content);
    return block.content.every(item => safeBlocks(item.content));
  });
}

const rich = z.custom<RichDoc>().transform((value, ctx) => {
  const doc = sanitizeRichText(value);
  if (doc && safeBlocks(doc.content)) return doc;
  ctx.addIssue({ code: "custom", message: "Invalid newsletter rich text" });
  return z.NEVER;
});
const label = z.string().trim().min(1).max(200);
const href = z.string().transform((value, ctx) => {
  const url = newsletterHttps(value);
  if (url) return url;
  ctx.addIssue({ code: "custom", message: "HTTPS link required" });
  return z.NEVER;
});

const legacyContent = z.array(z.discriminatedUnion("type", [
  z.object({ type: z.literal("richText"), doc: rich }).strict(),
  z.object({ type: z.literal("button"), label, href }).strict(),
  z.object({ type: z.literal("image"), fileId: z.uuid(), alt: label }).strict(),
  z.object({ type: z.literal("divider") }).strict(),
  z.object({ type: z.literal("spacing"), size: z.enum(["small", "medium", "large"]) }).strict(),
  z.object({ type: z.literal("footer") }).strict(),
])).min(1).max(50).refine(blocks => JSON.stringify(blocks).length <= 100_000 &&
  blocks.every((block, index) => block.type !== "footer" || index === blocks.length - 1));

/** A campaign body: the original block list, or the version 2 email document written by the block editor. */
export const newsletterContent = z.union([legacyContent, emailDocumentSchema]);
export type LegacyNewsletterContent = z.infer<typeof legacyContent>;
export type NewsletterContent = LegacyNewsletterContent | EmailDocument;

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Context = {
  preheader?: string | null;
  firstName?: string;
  ministryName?: string;
  unsubscribe: string;
  images?: ReadonlyMap<string, string>;
  /** Send path only, when the ministry counts link clicks: maps a content link to its redirect address. The unsubscribe link is never passed to it. */
  track?: (url: string) => string;
  /** Adds the footer line saying the ministry counts link clicks. */
  clicksCounted?: boolean;
};

export function renderNewsletter(definition: unknown, context: Context) {
  const parsed = newsletterContent.parse(definition);
  if (isEmailDocument(parsed)) return renderEmail(parsed, context);
  const content: LegacyNewsletterContent = parsed;
  const out = (url: string) => context.track ? context.track(url) : url;
  const unsubscribe = newsletterHttps(context.unsubscribe);
  if (!unsubscribe || /[<>]/.test(unsubscribe)) throw new Error("NEWSLETTER_UNSUBSCRIBE_UNAVAILABLE");
  const merge = (value: string) => value.replace(/\{\{(firstName|ministryName)\}\}/g, (_, key: "firstName" | "ministryName") =>
    context[key]?.trim() || (message(key === "firstName" ? "NewsletterEmail.fallbackFirstName" : "NewsletterEmail.fallbackMinistry")));

  function renderInline(nodes: RichInline[] = []) {
    return nodes.map(node => {
      if (node.type === "hardBreak") return { html: "<br>", text: "\n" };
      const value = merge(node.text);
      let html = escape(value), text = value;
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") html = '<strong>' + html + '</strong>';
        if (mark.type === "italic") html = '<em>' + html + '</em>';
        if (mark.type === "link") {
          const url = newsletterHttps(mark.attrs.href)!;
          html = '<a href="' + escape(out(url)) + '">' + html + '</a>';
          if (value !== url) text += " (" + out(url) + ")";
        }
      }
      return { html, text };
    });
  }

  function renderBlock(block: RichBlock): { html: string; text: string } {
    if (block.type === "paragraph" || block.type === "heading") {
      const tag = block.type === "heading" ? "h" + block.attrs.level : "p";
      const inline = renderInline(block.content);
      return { html: '<' + tag + '>' + inline.map(n => n.html).join("") + '</' + tag + '>', text: inline.map(n => n.text).join("") };
    }
    if (block.type === "blockquote") {
      const nested = block.content.map(renderBlock);
      return { html: "<blockquote>" + nested.map(n => n.html).join("") + "</blockquote>",
        text: nested.map(n => n.text).join("\n").split("\n").map(line => "> " + line).join("\n") };
    }
    const ordered = block.type === "orderedList";
    const tag = ordered ? "ol" : "ul";
    const start = ordered ? block.attrs?.start ?? 1 : 1;
    const items = block.content.map(item => item.content.map(renderBlock));
    return { html: '<' + tag + (start > 1 ? ' start="' + start + '"' : '') + '>' +
      items.map(item => "<li>" + item.map(n => n.html).join("") + "</li>").join("") + '</' + tag + '>',
    text: items.map((item, index) => (ordered ? (start + index) + ". " : "- ") + item.map(n => n.text).join("\n")).join("\n") };
  }

  const rendered = content.flatMap(block => {
    switch (block.type) {
      case "richText": return block.doc.content.map(renderBlock);
      case "button": return [{ html: '<p><a style="display:inline-block;padding:10px 16px;border:1px solid currentColor;border-radius:4px" href="' + escape(out(block.href)) + '">' + escape(merge(block.label)) + '</a></p>',
        text: merge(block.label) + " (" + out(block.href) + ")" }];
      case "image": {
        const src = newsletterHttps(context.images?.get(block.fileId) ?? "");
        if (!src) throw new Error("NEWSLETTER_IMAGE_UNAVAILABLE");
        return [{ html: '<p><img style="max-width:100%;height:auto" src="' + escape(src) + '" alt="' + escape(merge(block.alt)) + '"></p>', text: "[" + merge(block.alt) + "]" }];
      }
      case "divider": return [{ html: "<hr>", text: "---" }];
      case "spacing": return [{ html: '<div aria-hidden="true" style="height:' + ({ small: 8, medium: 16, large: 32 })[block.size] + 'px"></div>', text: "" }];
      case "footer": return [];
    }
  });
  const unsubscribeLabel = message("NewsletterEmail.unsubscribe");
  const counted = context.clicksCounted ? message("NewsletterEmail.clicksCounted") : "";
  rendered.push({ html: '<footer>' + (counted ? '<p>' + escape(counted) + '</p>' : '') + '<p>' + escape(merge("{{ministryName}}")) + ' · <a href="' + escape(unsubscribe) + '">' + escape(unsubscribeLabel) + '</a></p></footer>',
    text: (counted ? counted + "\n" : "") + merge("{{ministryName}}") + " · " + unsubscribeLabel + " (" + unsubscribe + ")" });
  const preheader = context.preheader?.trim();
  const hiddenPreheader = preheader ? '<div style="display:none;max-height:0;overflow:hidden">' + escape(preheader) + '</div>' : '';
  return {
    html: '<!doctype html><html lang="en"><body>' + hiddenPreheader + rendered.map(block => block.html).join("") + '</body></html>',
    text: [preheader ?? "", ...rendered.map(block => block.text)].join("\n\n").trim(),
    headers: { "List-Unsubscribe": "<" + unsubscribe + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

function starter(title: string, text: string): NewsletterContent {
  return [{ type: "richText", doc: { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: title }] },
    { type: "paragraph", content: [{ type: "text", text }] },
  ] } }, { type: "footer" }];
}

export const newsletterStarters = [
  { id: "ministry-update", name: "Ministry update", content: starter("From {{ministryName}}", "Hello {{firstName}},") },
  { id: "event-invitation", name: "Event invitation", content: starter("You’re invited", "Join us for an upcoming event.") },
  { id: "weekly-digest", name: "Weekly digest", content: starter("This week", "Here’s what’s happening at {{ministryName}}.") },
];
