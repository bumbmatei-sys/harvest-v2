import { message } from "../../i18n/messages";
import type { RichBlock, RichInline } from "../rich-text";
import { fontStacks, httpsUrl, radiusPx, type EmailBlock, type EmailDocument } from "./blocks";

export type RenderContext = { preheader?: string | null; firstName?: string; ministryName?: string; unsubscribe: string };
type Part = { html: string; text: string };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clamp = (hex: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
/** Readable ink on a colour: near-black or white by relative luminance. */
export function onColor(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#1a1a1a" : "#ffffff";
}
/** Mix a colour toward white (amount 0..1). */
export function tint(hex: string, amount: number) {
  const mix = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) + (255 - parseInt(hex.slice(i, i + 2), 16)) * amount).toString(16).padStart(2, "0");
  return "#" + mix(1) + mix(3) + mix(5);
}
export const spacing = { small: 12, medium: 28, large: 52 } as const;

/** Email-safe HTML: tables, inline styles, 600px, bulletproof buttons, https-only links and images, and an unsubscribe + address footer that no block can remove. */
export function renderEmail(doc: EmailDocument, context: RenderContext) {
  const unsubscribe = httpsUrl(context.unsubscribe);
  if (!unsubscribe || /[<>]/.test(unsubscribe)) throw new Error("NEWSLETTER_UNSUBSCRIBE_UNAVAILABLE");
  const brand = doc.brand;
  const primary = clamp(brand.primary, "#1f4d3a"), accent = clamp(brand.accent, "#c8963e"), canvas = clamp(brand.canvas, "#f4f1ea");
  const font = fontStacks[brand.font] ?? fontStacks.helvetica;
  const ink = "#23272e", muted = "#5d6470";
  const merge = (value: string) => value.replace(/\{\{(firstName|ministryName)\}\}/g, (_, key: "firstName" | "ministryName") =>
    context[key]?.trim() || message(key === "firstName" ? "NewsletterEmail.fallbackFirstName" : "NewsletterEmail.fallbackMinistry"));
  const esc = (value: string) => escapeHtml(merge(value));
  const multiline = (value: string) => esc(value).replace(/\r?\n/g, "<br>");
  const radius = radiusPx[brand.buttonRadius] ?? 6;

  const pad = (inner: string) => `<tr><td class="em-pad" style="padding:0 40px">${inner}</td></tr>`;
  const fullRow = (inner: string, style = "") => `<tr><td style="${style}">${inner}</td></tr>`;
  const h = (level: 1 | 2 | 3, value: string, extra = "") => {
    const size = { 1: 32, 2: 24, 3: 18 }[level];
    return `<h${level} class="em-ink" style="margin:0 0 12px;font-family:${font};font-size:${size}px;line-height:${Math.round(size * 1.25)}px;font-weight:${level === 3 ? 700 : 600};color:${ink};${extra}">${esc(value)}</h${level}>`;
  };
  const para = (value: string, extra = "") => value.trim()
    ? `<p class="em-ink" style="margin:0 0 16px;font-family:${font};font-size:16px;line-height:26px;color:${ink};${extra}">${multiline(value)}</p>` : "";

  /** Outlook-safe button: a VML round rectangle for Outlook, a padded anchor everywhere else. */
  function button(label: string, href: string, onPrimary = false, align: "left" | "center" = "left"): Part {
    const url = httpsUrl(href), labelText = merge(label).trim();
    if (!url || !labelText) return { html: "", text: "" };
    const solid = brand.buttonStyle === "solid" || onPrimary;
    const background = onPrimary ? "#ffffff" : primary, fg = onPrimary ? primary : onColor(primary);
    const border = onPrimary ? "#ffffff" : primary;
    const textColor = solid ? fg : primary, fill = solid ? background : "transparent";
    const arc = Math.min(50, Math.round(radius / 0.44));
    const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="margin:8px 0 20px"><tr><td align="center"${solid ? ` bgcolor="${background}"` : ""} class="em-button" style="border-radius:${radius}px;border:2px solid ${border};background:${fill}">`
      + `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(url)}" style="height:48px;v-text-anchor:middle;width:220px" arcsize="${arc}%" strokecolor="${border}" ${solid ? `fillcolor="${background}"` : 'filled="f"'}><w:anchorlock/><center style="color:${textColor};font-family:${font};font-size:16px;font-weight:bold">${escapeHtml(labelText)}</center></v:roundrect><![endif]-->`
      + `<!--[if !mso]><!--><a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${font};font-size:16px;line-height:20px;font-weight:600;color:${textColor};text-decoration:none;border-radius:${radius}px">${escapeHtml(labelText)}</a><!--<![endif]-->`
      + `</td></tr></table>`;
    return { html, text: `${labelText}: ${url}` };
  }
  const image = (src: string, altText: string) => {
    const url = httpsUrl(src);
    return url ? `<img src="${escapeHtml(url)}" alt="${esc(altText)}" width="520" style="display:block;width:100%;max-width:100%;height:auto;border:0">` : "";
  };

  function inline(nodes: RichInline[] | undefined): Part {
    const parts = (nodes ?? []).map((node): Part => {
      if (node.type === "hardBreak") return { html: "<br>", text: "\n" };
      const value = merge(node.text);
      let html = escapeHtml(value), text = value;
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") html = `<strong>${html}</strong>`;
        else if (mark.type === "italic") html = `<em>${html}</em>`;
        else if (mark.type === "link") {
          const url = httpsUrl(mark.attrs.href);
          if (!url) continue;
          html = `<a href="${escapeHtml(url)}" style="color:${primary};text-decoration:underline">${html}</a>`;
          if (value !== url) text += ` (${url})`;
        }
      }
      return { html, text };
    });
    return { html: parts.map(p => p.html).join(""), text: parts.map(p => p.text).join("") };
  }
  function rich(block: RichBlock): Part {
    if (block.type === "paragraph") {
      const i = inline(block.content);
      return { html: i.html ? `<p class="em-ink" style="margin:0 0 16px;font-family:${font};font-size:16px;line-height:26px;color:${ink}">${i.html}</p>` : "", text: i.text };
    }
    if (block.type === "heading") {
      const i = inline(block.content), size = block.attrs.level === 2 ? 24 : 18;
      return { html: `<h${block.attrs.level} class="em-ink" style="margin:8px 0 12px;font-family:${font};font-size:${size}px;line-height:${Math.round(size * 1.3)}px;color:${ink}">${i.html}</h${block.attrs.level}>`, text: i.text.toUpperCase() };
    }
    if (block.type === "blockquote") {
      const nested = block.content.map(rich);
      return { html: `<blockquote style="margin:0 0 16px;padding:4px 0 4px 16px;border-left:3px solid ${accent};color:${muted}">${nested.map(n => n.html).join("")}</blockquote>`,
        text: nested.map(n => n.text).join("\n").split("\n").map(l => "> " + l).join("\n") };
    }
    const ordered = block.type === "orderedList", start = ordered ? block.attrs?.start ?? 1 : 1;
    const items = block.content.map(item => item.content.map(rich));
    const tag = ordered ? "ol" : "ul";
    return { html: `<${tag}${start > 1 ? ` start="${start}"` : ""} style="margin:0 0 16px;padding-left:24px;font-family:${font};font-size:16px;line-height:26px;color:${ink}">${items.map(item => `<li>${item.map(n => n.html.replace(/^<p[^>]*>|<\/p>$/g, "")).join("")}</li>`).join("")}</${tag}>`,
      text: items.map((item, index) => `${ordered ? start + index + ". " : "- "}${item.map(n => n.text).join("\n")}`).join("\n") };
  }

  function renderBlock(block: EmailBlock): Part {
    switch (block.type) {
      case "header": {
        const logo = brand.logoUrl && block.showLogo ? httpsUrl(brand.logoUrl) : null;
        const title = merge(block.title).trim() || context.ministryName?.trim() || "";
        const inner = `${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(title)}" height="40" style="display:inline-block;height:40px;width:auto;border:0;vertical-align:middle;margin-right:12px">` : ""}<span style="font-family:${font};font-size:18px;font-weight:700;letter-spacing:0.02em;color:${primary};vertical-align:middle">${escapeHtml(title)}</span>`;
        return { html: fullRow(`<div class="em-pad" style="padding:28px 40px 20px;text-align:${block.align}">${inner}</div>`), text: title.toUpperCase() };
      }
      case "hero": {
        const img = image(block.imageUrl, block.alt), btn = button(block.buttonLabel, block.buttonUrl, !img);
        const light = `color:${onColor(primary)};`;
        const body = `${block.heading ? h(1, block.heading, img ? "" : light) : ""}${block.text ? para(block.text, img ? "" : light) : ""}${btn.html}`;
        const html = img ? fullRow(`${img}<div class="em-pad" style="padding:28px 40px 4px">${body}</div>`)
          : fullRow(`<div class="em-pad em-hero" style="padding:52px 40px 28px;background:${primary};text-align:left"><div style="width:44px;height:3px;background:${accent};margin:0 0 24px"></div>${body}</div>`, `background:${primary}`);
        return { html, text: [merge(block.heading), merge(block.text), btn.text].filter(Boolean).join("\n") };
      }
      case "text": {
        const parts = block.doc.content.map(rich);
        return { html: pad(`<div style="padding-top:16px">${parts.map(p => p.html).join("")}</div>`), text: parts.map(p => p.text).filter(Boolean).join("\n\n") };
      }
      case "imageText": {
        const img = image(block.imageUrl, block.alt);
        const copy = `${block.heading ? h(3, block.heading) : ""}${para(block.text)}`;
        const media = `<td class="em-stack" width="45%" valign="top" style="padding:${block.side === "left" ? "0 20px 0 0" : "0 0 0 20px"}">${img}</td>`;
        const words = `<td class="em-stack" width="${img ? 55 : 100}%" valign="top">${copy}</td>`;
        return { html: pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0"><tr>${img ? (block.side === "left" ? media + words : words + media) : words}</tr></table>`),
          text: [merge(block.heading), merge(block.text), block.alt && img ? `[${merge(block.alt)}]` : ""].filter(Boolean).join("\n") };
      }
      case "columns": {
        const col = (heading: string, copy: string, gap: string) => `<td class="em-stack" width="50%" valign="top" style="padding:${gap}">${heading ? h(3, heading) : ""}${para(copy, "font-size:15px;line-height:24px;")}</td>`;
        return { html: pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0"><tr>${col(block.leftHeading, block.leftText, "0 14px 0 0")}${col(block.rightHeading, block.rightText, "0 0 0 14px")}</tr></table>`),
          text: [merge(block.leftHeading), merge(block.leftText), merge(block.rightHeading), merge(block.rightText)].filter(Boolean).join("\n\n") };
      }
      case "quote": {
        return { html: pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0"><tr><td class="em-quote" style="padding:24px 28px;background:${tint(accent, 0.86)};border-left:4px solid ${accent}"><p class="em-ink" style="margin:0;font-family:${font};font-size:22px;line-height:32px;font-style:italic;color:${ink}">&ldquo;${multiline(block.text)}&rdquo;</p>${block.cite ? `<p style="margin:12px 0 0;font-family:${font};font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${muted}">${esc(block.cite)}</p>` : ""}</td></tr></table>`),
          text: `"${merge(block.text)}"${block.cite ? ` - ${merge(block.cite)}` : ""}` };
      }
      case "event": {
        const btn = button(block.buttonLabel, block.buttonUrl);
        const when = [block.date, block.time].map(merge).filter(Boolean).join(" · ");
        return { html: pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0"><tr><td class="em-card" style="padding:24px 28px;border:1px solid ${tint(primary, 0.7)};border-top:4px solid ${primary};background:#ffffff"><p style="margin:0 0 6px;font-family:${font};font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${accent}">${escapeHtml(when)}</p>${h(2, block.title)}${block.location ? para(block.location, `color:${muted};margin-bottom:8px;`) : ""}${btn.html}</td></tr></table>`),
          text: [merge(block.title), when, merge(block.location), btn.text].filter(Boolean).join("\n") };
      }
      case "giving": {
        const btn = button(block.buttonLabel, block.buttonUrl, false, "center");
        return { html: pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0"><tr><td class="em-card" align="center" style="padding:32px 28px;background:${tint(primary, 0.9)};text-align:center">${block.heading ? h(2, block.heading, "text-align:center;") : ""}${block.text ? para(block.text, "text-align:center;") : ""}${btn.html}</td></tr></table>`),
          text: [merge(block.heading), merge(block.text), btn.text].filter(Boolean).join("\n") };
      }
      case "video": {
        const img = image(block.thumbnailUrl, block.alt), link = httpsUrl(block.videoUrl);
        const picture = img ? (link ? `<a href="${escapeHtml(link)}" target="_blank">${img}</a>` : img) : "";
        const watch = link ? `<p style="margin:12px 0 0;font-family:${font};font-size:15px"><a href="${escapeHtml(link)}" style="color:${primary};font-weight:600">${escapeHtml(message("NewsletterEmail.watchVideo"))}</a></p>` : "";
        return { html: pad(`<div style="margin:20px 0">${picture}${block.caption ? para(block.caption, `margin-top:10px;font-size:14px;color:${muted};`) : ""}${watch}</div>`),
          text: [merge(block.caption), link ? `${message("NewsletterEmail.watchVideo")}: ${link}` : ""].filter(Boolean).join("\n") };
      }
      case "social": {
        const links = block.links.flatMap(link => { const url = httpsUrl(link.url); return url && link.label.trim() ? [{ label: merge(link.label), url }] : []; });
        if (!links.length) return { html: "", text: "" };
        return { html: pad(`<p style="margin:16px 0;text-align:center;font-family:${font};font-size:14px">${links.map(l => `<a href="${escapeHtml(l.url)}" style="color:${primary};text-decoration:underline;margin:0 10px">${escapeHtml(l.label)}</a>`).join("")}</p>`),
          text: links.map(l => `${l.label}: ${l.url}`).join("\n") };
      }
      case "divider": return { html: pad(`<hr style="border:0;border-top:1px solid ${tint(primary, 0.75)};margin:24px 0">`), text: "---" };
      case "spacer": return { html: fullRow(`<div aria-hidden="true" style="height:${spacing[block.size]}px;line-height:${spacing[block.size]}px;font-size:1px">&nbsp;</div>`), text: "" };
      case "footer": return { html: block.note.trim() ? pad(`<p style="margin:20px 0 0;text-align:center;font-family:${font};font-size:15px;line-height:24px;color:${ink}">${multiline(block.note)}</p>`) : "", text: merge(block.note) };
    }
  }

  const rendered = doc.blocks.map(renderBlock);
  const ministry = merge("{{ministryName}}");
  const address = brand.address.trim() || message("NewsletterEmail.addressMissing");
  const unsubscribeLabel = message("NewsletterEmail.unsubscribe");
  const footerHtml = `<tr><td class="em-pad" style="padding:28px 40px 36px;text-align:center"><p style="margin:0 0 6px;font-family:${font};font-size:13px;line-height:20px;color:${muted}">${escapeHtml(ministry)}</p><p style="margin:0 0 6px;font-family:${font};font-size:13px;line-height:20px;color:${muted}">${escapeHtml(address).replace(/\r?\n/g, "<br>")}</p><p style="margin:0;font-family:${font};font-size:13px;line-height:20px"><a href="${escapeHtml(unsubscribe)}" style="color:${muted};text-decoration:underline">${escapeHtml(unsubscribeLabel)}</a></p></td></tr>`;
  const footerText = `${ministry}\n${address}\n${unsubscribeLabel}: ${unsubscribe}`;
  const preheader = context.preheader?.trim() ?? "";
  const hidden = preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${canvas}">${escapeHtml(preheader)}</div>` : "";
  const css = `@media only screen and (max-width:620px){.em-wrap{width:100%!important}.em-pad{padding-left:20px!important;padding-right:20px!important}.em-stack{display:block!important;width:100%!important;padding:0 0 12px!important}.em-hero{padding-top:36px!important}}`
    + `@media (prefers-color-scheme:dark){.em-bg{background:#121417!important}.em-shell{background:#1b1e23!important}.em-ink{color:#eceef1!important}.em-card{background:#232830!important;border-color:#3a414c!important}.em-quote{background:#2a2f37!important}}`;
  const html = `<!doctype html><html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]--><style>${css}</style></head>`
    + `<body class="em-bg" style="margin:0;padding:0;background:${canvas}">${hidden}<table role="presentation" class="em-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${canvas}" style="background:${canvas}"><tr><td align="center" style="padding:24px 12px">`
    + `<table role="presentation" class="em-wrap em-shell" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:600px;max-width:600px;background:#ffffff">${rendered.map(p => p.html).join("")}${footerHtml}</table></td></tr></table></body></html>`;
  const text = [preheader, ...rendered.map(p => p.text), footerText].filter(Boolean).join("\n\n").trim();
  return { html, text, headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
}
