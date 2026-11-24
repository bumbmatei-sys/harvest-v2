import { z } from "zod";
import { emailColors } from "./email-theme-registry";
import { sanitizeRichText, type RichBlock, type RichDoc, type RichInline } from "../rich-text";

/** Newsletter email document (version 2): a list of blocks plus the ministry brand kit, rendered by `renderEmail`. */
export function httpsUrl(value: string) {
  if (value.length > 2000 || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export const fontIds = ["helvetica", "georgia", "trebuchet", "verdana", "palatino", "tahoma"] as const;
export type FontId = (typeof fontIds)[number];
export const fontStacks: Record<FontId, string> = {
  helvetica: "Helvetica Neue,Helvetica,Arial,sans-serif", georgia: "Georgia,'Times New Roman',serif",
  trebuchet: "'Trebuchet MS',Helvetica,Arial,sans-serif", verdana: "Verdana,Geneva,sans-serif",
  palatino: "Palatino,'Palatino Linotype','Book Antiqua',serif", tahoma: "Tahoma,Geneva,sans-serif",
};
export const buttonStyles = ["solid", "outline"] as const;
export const buttonRadii = ["square", "soft", "pill"] as const;
export const radiusPx = { square: 0, soft: 6, pill: 999 } as const;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toLowerCase());
const optionalUrl = z.string().max(2000).refine(value => value === "" || httpsUrl(value) !== null, "HTTPS link required")
  .transform(value => value === "" ? "" : httpsUrl(value)!);
const text = (max: number) => z.string().max(max);

export const brandKitSchema = z.object({
  logoUrl: optionalUrl, primary: color, accent: color, canvas: color, font: z.enum(fontIds),
  buttonStyle: z.enum(buttonStyles), buttonRadius: z.enum(buttonRadii), address: text(300),
}).strict();
export type BrandKit = z.infer<typeof brandKitSchema>;
export const defaultBrand: BrandKit = {
  logoUrl: "", primary: emailColors.defaultPrimary, accent: emailColors.defaultAccent, canvas: emailColors.defaultCanvas, font: "georgia",
  buttonStyle: "solid", buttonRadius: "soft", address: "",
};

/** Text blocks keep Tiptap JSON; formats the email cannot carry (strike, underline, unsafe links) are dropped, never rejected. */
function cleanInline(nodes: RichInline[] | undefined): RichInline[] {
  return (nodes ?? []).map(node => node.type === "hardBreak" ? node : { ...node, marks: (node.marks ?? []).filter(mark =>
    mark.type === "bold" || mark.type === "italic" || (mark.type === "link" && httpsUrl(mark.attrs.href) !== null)) });
}
function cleanBlocks(blocks: RichBlock[]): RichBlock[] {
  return blocks.map((block): RichBlock => {
    if (block.type === "paragraph" || block.type === "heading") return { ...block, content: cleanInline(block.content) } as RichBlock;
    if (block.type === "blockquote") return { ...block, content: cleanBlocks(block.content) };
    return { ...block, content: block.content.map(item => ({ ...item, content: cleanBlocks(item.content) })) } as RichBlock;
  });
}
const richDoc = z.custom<RichDoc>().transform((value, ctx) => {
  const doc = sanitizeRichText(value);
  if (doc) return { type: "doc" as const, content: cleanBlocks(doc.content) };
  ctx.addIssue({ code: "custom", message: "Invalid text" });
  return z.NEVER;
});

const id = z.string().regex(/^[A-Za-z0-9_-]{4,40}$/);
const alt = text(200);
/** An uploaded image (a ready, public file of the ministry) wins over `imageUrl`; both are optional. */
const picture = { fileId: z.uuid().optional(), decorative: z.boolean().optional() };
const align = z.enum(["left", "center"]);
const base = { id };

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("header"), title: text(120), showLogo: z.boolean(), align }).strict(),
  z.object({ ...base, type: z.literal("hero"), imageUrl: optionalUrl, ...picture, alt, heading: text(160), text: text(600), buttonLabel: text(60), buttonUrl: optionalUrl }).strict(),
  z.object({ ...base, type: z.literal("text"), doc: richDoc }).strict(),
  z.object({ ...base, type: z.literal("imageText"), imageUrl: optionalUrl, ...picture, alt, heading: text(160), text: text(800), side: z.enum(["left", "right"]) }).strict(),
  z.object({ ...base, type: z.literal("columns"), leftHeading: text(100), leftText: text(500), rightHeading: text(100), rightText: text(500) }).strict(),
  z.object({ ...base, type: z.literal("quote"), text: text(600), cite: text(120) }).strict(),
  z.object({ ...base, type: z.literal("event"), title: text(160), date: text(60), time: text(60), location: text(160), buttonLabel: text(60), buttonUrl: optionalUrl }).strict(),
  z.object({ ...base, type: z.literal("giving"), heading: text(160), text: text(500), buttonLabel: text(60), buttonUrl: optionalUrl }).strict(),
  z.object({ ...base, type: z.literal("video"), thumbnailUrl: optionalUrl, ...picture, alt, videoUrl: optionalUrl, caption: text(200) }).strict(),
  z.object({ ...base, type: z.literal("image"), imageUrl: optionalUrl, ...picture, alt, linkUrl: optionalUrl }).strict(),
  z.object({ ...base, type: z.literal("social"), links: z.array(z.object({ label: text(40), url: optionalUrl }).strict()).max(6) }).strict(),
  z.object({ ...base, type: z.literal("divider") }).strict(),
  z.object({ ...base, type: z.literal("spacer"), size: z.enum(["small", "medium", "large"]) }).strict(),
  z.object({ ...base, type: z.literal("footer"), note: text(300) }).strict(),
]);
export type EmailBlock = z.infer<typeof blockSchema>;
export type BlockType = EmailBlock["type"];
export const blockTypes: readonly BlockType[] = ["header", "hero", "text", "imageText", "columns", "quote", "event", "giving", "video", "image", "social", "divider", "spacer", "footer"];

export const coverSchema = z.object({ imageUrl: optionalUrl, ...picture, alt }).strict();
export type EmailCover = z.infer<typeof coverSchema>;

type Picture = { imageUrl?: string; fileId?: string; alt: string; decorative?: boolean };
/** The picture of a block (the thumbnail for a video), or null for a block without one. */
export function blockPicture(block: EmailBlock): Picture | null {
  switch (block.type) {
    case "hero": case "imageText": case "image": return block;
    case "video": return { imageUrl: block.thumbnailUrl, fileId: block.fileId, alt: block.alt, decorative: block.decorative };
    default: return null;
  }
}
/** Alt text is required for uploaded images and the image block, unless the image is marked decorative. Older linked images only warn (inbox check). */
export function pictureNeedsAlt(picture: Picture, always: boolean) {
  const has = Boolean(picture.fileId || picture.imageUrl);
  return has && (always || Boolean(picture.fileId)) && !picture.decorative && !picture.alt.trim();
}
/** Every uploaded image the document refers to (cover and blocks), once each. */
export function documentFileIds(doc: Pick<EmailDocument, "cover" | "blocks">) {
  const ids = new Set<string>();
  if (doc.cover?.fileId) ids.add(doc.cover.fileId);
  for (const block of doc.blocks) { const picture = blockPicture(block); if (picture?.fileId) ids.add(picture.fileId); }
  return [...ids];
}

export const emailDocumentSchema = z.object({ version: z.literal(2), brand: brandKitSchema, cover: coverSchema.optional(), blocks: z.array(blockSchema).min(1).max(50) }).strict()
  .refine(doc => JSON.stringify(doc).length <= 100_000 && new Set(doc.blocks.map(block => block.id)).size === doc.blocks.length)
  .refine(doc => !(doc.cover && pictureNeedsAlt(doc.cover, false)) && doc.blocks.every(block => { const picture = blockPicture(block); return !picture || !pictureNeedsAlt(picture, block.type === "image"); }),
    { message: "Image description required" });
export type EmailDocument = z.infer<typeof emailDocumentSchema>;

export const isEmailDocument = (value: unknown): value is EmailDocument => typeof value === "object" && value !== null && !Array.isArray(value) && (value as { version?: unknown }).version === 2;

const paragraph = (value: string): RichDoc => ({ type: "doc", content: [{ type: "paragraph", content: value ? [{ type: "text", text: value }] : [] }] });
export const richParagraphs = (...values: string[]): RichDoc => ({ type: "doc", content: values.map(value => paragraph(value).content[0]) });
export function newId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "b" + Array.from(bytes, byte => byte.toString(36).padStart(2, "0")).join("").slice(0, 12);
}

/** A block with its defaults; copy comes from the caller (the message catalogue) so nothing user-facing is hard-coded here. */
export function newBlock(type: BlockType, copy: Record<string, string>, id = newId()): EmailBlock {
  const c = (key: string) => copy[key] ?? "";
  switch (type) {
    case "header": return { id, type, title: c("title"), showLogo: true, align: "left" };
    case "hero": return { id, type, imageUrl: "", alt: "", heading: c("heading"), text: c("text"), buttonLabel: c("button"), buttonUrl: "" };
    case "text": return { id, type, doc: richParagraphs(c("text")) };
    case "imageText": return { id, type, imageUrl: "", alt: "", heading: c("heading"), text: c("text"), side: "left" };
    case "columns": return { id, type, leftHeading: c("leftHeading"), leftText: c("leftText"), rightHeading: c("rightHeading"), rightText: c("rightText") };
    case "quote": return { id, type, text: c("text"), cite: c("cite") };
    case "event": return { id, type, title: c("title"), date: c("date"), time: c("time"), location: c("location"), buttonLabel: c("button"), buttonUrl: "" };
    case "giving": return { id, type, heading: c("heading"), text: c("text"), buttonLabel: c("button"), buttonUrl: "" };
    case "video": return { id, type, thumbnailUrl: "", alt: "", videoUrl: "", caption: c("caption") };
    case "image": return { id, type, imageUrl: "", alt: "", linkUrl: "" };
    case "social": return { id, type, links: [{ label: c("linkOne"), url: "" }, { label: c("linkTwo"), url: "" }] };
    case "divider": return { id, type };
    case "spacer": return { id, type, size: "medium" };
    case "footer": return { id, type, note: c("note") };
  }
}

export function moveBlock<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
