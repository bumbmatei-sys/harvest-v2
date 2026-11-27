import { z } from "zod";
import type { GivingPublicMethod } from "./ways-to-give";
import { validVideo, videoProviders, type LessonVideo } from "./lesson-video";

// Link in bio: one public page per ministry (docs/plans/link-in-bio.md). Everything here is pure: the draft definition, its limits, the handle rules and the
// projection the public page and the owner's live preview share. Nothing here reads or stores anything.

export const bioLimits = { blocks: 20, socials: 8, name: 100, bio: 500, label: 80, url: 2048, eventTitle: 100, eventWhen: 60, messageTitle: 60,
  subtitle: 80, details: 8, detailValue: 100, senderName: 100, senderEmail: 254, messageBody: 2000, tabs: 6, tabLabel: 24, bioLine: 160,
  catalogItems: 6, fileItems: 10, videoTitle: 100, address: 240, testimonials: 6, quote: 400, personName: 80, phone: 24 } as const;
/** The header's short bio is one line (founder decision 27 Nov): the first line of the text, trimmed and cut to `bioLine`. */
export const oneLine = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, bioLimits.bioLine) ?? "";

/** Link icons (an allow-list, drawn by the screen). */
export const bioIcons = ["globe", "mail", "phone", "heart", "book", "calendar", "video", "music", "map", "gift"] as const;
export type BioIcon = typeof bioIcons[number];
export const bioNetworks = ["instagram", "facebook", "youtube", "x", "tiktok", "linkedin", "threads", "whatsapp", "podcast", "website"] as const;
export type BioNetwork = typeof bioNetworks[number];
export const bioSchemes = ["auto", "light", "dark"] as const;
export const bioButtonStyles = ["filled", "outline"] as const;

/**
 * Tabs of the public page (founder decision 25 Nov: up to six, renameable, reorderable, or a single page with no tabs). The first pages were made with two
 * fixed tabs, `home` and `partnership`; those ids stay valid and show their default names until the owner renames them. New tabs get an eight-character id.
 */
export const bioTabIds = ["home", "partnership"] as const;
export type BioLegacyTabId = typeof bioTabIds[number];
export type BioTabId = string;
export const isLegacyTabId = (id: string): id is BioLegacyTabId => (bioTabIds as readonly string[]).includes(id);
export const bioLayouts = ["tabs", "single"] as const;
export type BioLayout = typeof bioLayouts[number];
export const bioPhotoAligns = ["center", "left"] as const;
export type BioPhotoAlign = typeof bioPhotoAligns[number];
/** One style for every social and website icon of a page: the network's mark in the text colour, or in its own colour. */
export const bioIconStyles = ["outline", "color"] as const;
export type BioIconStyle = typeof bioIconStyles[number];
/** Detail rows the owner may add: nothing is shown unless the owner typed it (no birthday, relationship or gender rows exist). */
export const bioDetailKinds = ["location", "ministry", "role", "website", "languages"] as const;
export type BioDetailKind = typeof bioDetailKinds[number];

// ---- Handle -----------------------------------------------------------------------------------------------------------------------------------------------
/** Words that are routes or product names. The database function `valid_bio_handle` holds the same list; a test keeps the two in step. */
export const bioReservedHandles = ["account", "admin", "api", "app", "assets", "auth", "bio", "c", "click", "communities", "connect", "discover", "edit", "f", "harvest",
  "health", "help", "l", "link", "links", "login", "message", "messages", "new", "newsletter", "photo", "preview", "profile", "resources", "s", "settings", "sign-in",
  "subscribe", "support", "workspace", "workspaces", "www"] as const;
const handlePattern = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
export type HandleProblem = "length" | "characters" | "reserved";
export function handleProblem(value: string): HandleProblem | null {
  if (value.length < 3 || value.length > 30) return "length";
  if (!handlePattern.test(value) || value.includes("--")) return "characters";
  if ((bioReservedHandles as readonly string[]).includes(value)) return "reserved";
  return null;
}
export const bioHandleSchema = z.string().trim().toLowerCase().refine((value) => handleProblem(value) === null);
/** A suggestion from the ministry name: lower-case words joined by single hyphens, cut to 30 characters. Empty when nothing usable is left. */
export function suggestHandle(name: string) {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/g, "");
  return handleProblem(base) === null ? base : "";
}

// ---- Links ------------------------------------------------------------------------------------------------------------------------------------------------
/**
 * A link a ministry may publish: https only, no credentials, no control characters, a real host name. Returns the normalised address or null.
 * Query strings are allowed (campaign links need them); nothing is fetched, proxied or redirected by Harvest.
 */
export function safeHttpsUrl(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > bioLimits.url || /[\u0000-\u001f\u007f\s]/.test(text)) return null;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") || url.hostname.endsWith(".")) return null;
  return url.href;
}
const httpsUrl = z.string().max(bioLimits.url).transform((value, ctx) => { const safe = safeHttpsUrl(value); if (!safe) ctx.addIssue({ code: "custom", message: "url" }); return safe ?? value; });
const plain = (max: number) => z.string().max(max).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) && !/[<>]/.test(value));
const trimmed = (max: number, min = 1) => plain(max).transform((value) => value.trim()).pipe(z.string().min(min));
const blockId = z.string().regex(/^[a-z0-9]{8}$/);
const tabId = z.string().regex(/^(home|partnership|[a-z0-9]{8})$/);
const tab = tabId.default("home");
const signupSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/);

const uuidList = (max: number) => z.array(z.uuid()).min(1).max(max).refine((list) => new Set(list).size === list.length);
/** A phone number as people write it: digits with an optional leading +, spaces, dots, dashes and brackets; 6 to 15 digits. */
export const bioPhonePattern = /^\+?[0-9(][0-9 ().-]{4,22}[0-9]$/;
export const phoneDigits = (value: string) => value.replace(/[^0-9]/g, "");
const phone = z.string().trim().max(bioLimits.phone).refine((value) => value === "" || (bioPhonePattern.test(value) && phoneDigits(value).length >= 6 && phoneDigits(value).length <= 15));
const optionalEmail = z.string().trim().max(254).refine((value) => value === "" || z.email().safeParse(value).success);

export const bioBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("link"), id: blockId, hidden: z.boolean(), tab, label: trimmed(bioLimits.label), url: httpsUrl, icon: z.enum(bioIcons).nullable() }).strict(),
  z.object({ type: z.literal("message"), id: blockId, hidden: z.boolean(), tab, title: trimmed(bioLimits.messageTitle) }).strict(),
  z.object({ type: z.literal("event"), id: blockId, hidden: z.boolean(), tab, title: trimmed(bioLimits.eventTitle), when: trimmed(bioLimits.eventWhen), url: httpsUrl }).strict(),
  z.object({ type: z.literal("community"), id: blockId, hidden: z.boolean(), tab, communityId: z.uuid() }).strict(),
  z.object({ type: z.literal("newsletter"), id: blockId, hidden: z.boolean(), tab, slug: signupSlug }).strict(),
  // Ways to give (CW-10): the ministry's enabled giving methods, managed under Operations > Giving. At most one.
  z.object({ type: z.literal("giving"), id: blockId, hidden: z.boolean(), tab, title: trimmed(bioLimits.messageTitle) }).strict(),
  // Rework PR 2 (founder decision 25 Nov). Products and courses: the ministry's own published catalog items, resolved on every public read.
  z.object({ type: z.literal("catalog"), id: blockId, hidden: z.boolean(), tab, title: plain(bioLimits.messageTitle).transform((value) => value.trim()), itemIds: uuidList(bioLimits.catalogItems) }).strict(),
  // PDFs and ebooks: download products shown as file rows; the files stay behind the product's own page and its sign-in.
  z.object({ type: z.literal("files"), id: blockId, hidden: z.boolean(), tab, title: plain(bioLimits.messageTitle).transform((value) => value.trim()), itemIds: uuidList(bioLimits.fileItems) }).strict(),
  // A hosted form of the ministry (a prayer request, for example), opened at its own address. The button text is the owner's.
  z.object({ type: z.literal("form"), id: blockId, hidden: z.boolean(), tab, title: trimmed(bioLimits.messageTitle), slug: signupSlug }).strict(),
  // A video link, stored as provider and id only (the course lessons' parser); played behind a click-to-load facade.
  z.object({ type: z.literal("video"), id: blockId, hidden: z.boolean(), tab, title: plain(bioLimits.videoTitle).transform((value) => value.trim()), provider: z.enum(videoProviders), videoId: z.string().max(80) }).strict(),
  z.object({ type: z.literal("contact"), id: blockId, hidden: z.boolean(), tab, email: optionalEmail, phone, whatsapp: phone }).strict(),
  // An address with an "Open in maps" button. No map is embedded (founder decision 27 Nov).
  z.object({ type: z.literal("location"), id: blockId, hidden: z.boolean(), tab, label: plain(bioLimits.label).transform((value) => value.trim()), address: trimmed(bioLimits.address) }).strict(),
  // Live now: a link the owner switches on by hand; visitors see it, with a LIVE badge, only while it is on.
  z.object({ type: z.literal("live"), id: blockId, hidden: z.boolean(), tab, title: trimmed(bioLimits.label), url: httpsUrl, on: z.boolean() }).strict(),
  z.object({ type: z.literal("testimonials"), id: blockId, hidden: z.boolean(), tab, items: z.array(z.object({ id: blockId, quote: trimmed(bioLimits.quote), name: trimmed(bioLimits.personName),
    role: plain(bioLimits.personName).transform((value) => value.trim()) }).strict()).min(1).max(bioLimits.testimonials).refine((list) => new Set(list.map((x) => x.id)).size === list.length) }).strict(),
]);
/** Block types a visitor's click is counted for (the database's bio_record_click_scoped holds the same list). */
export const bioClickTypes = ["link", "event", "community", "catalog", "files", "form", "video", "contact", "location", "live"] as const;
export type BioBlock = z.infer<typeof bioBlockSchema>;
export type BioBlockType = BioBlock["type"];

const defaultTabs = bioTabIds.map((id) => ({ id, label: "", hidden: false }));
export const bioDefinitionSchema = z.object({
  kind: z.literal("bio-v1"),
  name: plain(bioLimits.name).transform((value) => value.trim()),
  subtitle: plain(bioLimits.subtitle).transform((value) => value.trim()).default(""),
  bio: plain(bioLimits.bio).transform((value) => value.trim()),
  details: z.array(z.object({ id: blockId, kind: z.enum(bioDetailKinds), value: trimmed(bioLimits.detailValue), hidden: z.boolean() }).strict()).max(bioLimits.details).default([])
    .refine((list) => new Set(list.map((item) => item.id)).size === list.length),
  // A block whose tab is missing or hidden is not shown (the database's bio_block_shown agrees); in the single-page layout tabs are ignored.
  tabs: z.array(z.object({ id: tabId, label: plain(bioLimits.tabLabel).transform((value) => value.trim()).default(""), hidden: z.boolean() }).strict()).max(bioLimits.tabs).default(defaultTabs)
    .refine((list) => new Set(list.map((item) => item.id)).size === list.length),
  layout: z.enum(bioLayouts).default("tabs"),
  /** Whether the cover band shows at all (an uploaded image, or the brand gradient without one). */
  cover: z.boolean().default(true),
  photoAlign: z.enum(bioPhotoAligns).default("center"),
  iconStyle: z.enum(bioIconStyles).default("outline"),
  scheme: z.enum(bioSchemes),
  buttons: z.enum(bioButtonStyles),
  socials: z.array(z.object({ network: z.enum(bioNetworks), url: httpsUrl }).strict()).max(bioLimits.socials)
    .refine((list) => new Set(list.map((item) => item.network)).size === list.length),
  blocks: z.array(bioBlockSchema).max(bioLimits.blocks)
    .refine((list) => new Set(list.map((block) => block.id)).size === list.length)
    .refine((list) => list.filter((block) => block.type === "message").length <= 1)
    .refine((list) => list.filter((block) => block.type === "giving").length <= 1)
    .refine((list) => list.every((block) => block.type !== "video" || validVideo({ provider: block.provider, id: block.videoId })))
    .refine((list) => list.every((block) => block.type !== "contact" || Boolean(block.email || block.phone || block.whatsapp))),
}).strict()
  // Founder decision 27 Nov: the header shows the name, the photo, a one-line short bio and the icons. A subtitle becomes the one-line bio when there is no
  // bio, and the details list is dropped (that information belongs in blocks). Older pages are normalised here on every read and saved that way.
  .transform((definition) => ({ ...definition, bio: oneLine(definition.bio || definition.subtitle), subtitle: "", details: [] as typeof definition.details }));
export type BioDefinition = z.infer<typeof bioDefinitionSchema>;

export const emptyBioDefinition = (name = ""): BioDefinition => ({ kind: "bio-v1", name: name.slice(0, bioLimits.name), subtitle: "", bio: "", details: [], tabs: bioTabIds.map((id) => ({ id, label: "", hidden: false })),
  layout: "tabs", cover: true, photoAlign: "center", iconStyle: "outline", scheme: "auto", buttons: "filled", socials: [], blocks: [] });

/** Whether a block reaches visitors: not hidden and, with tabs, on a tab that exists and is shown. Mirrors the database function `bio_block_shown`. */
export function blockShown(definition: Pick<BioDefinition, "tabs" | "layout">, block: { hidden: boolean; tab: string }) {
  if (block.hidden) return false;
  return definition.layout === "single" || definition.tabs.some((t) => t.id === block.tab && !t.hidden);
}
/** The tabs a visitor sees, in order, each with its shown blocks. The single-page layout is one unnamed tab holding every shown block. */
export function shownTabs<B extends { hidden: boolean; tab: string }>(definition: Pick<BioDefinition, "tabs" | "layout">, blocks: readonly B[]): { id: string; label: string; blocks: B[] }[] {
  if (definition.layout === "single") return [{ id: definition.tabs[0]?.id ?? "home", label: "", blocks: blocks.filter((b) => !b.hidden) }];
  return definition.tabs.filter((t) => !t.hidden).map((t) => ({ id: t.id, label: t.label, blocks: blocks.filter((b) => !b.hidden && b.tab === t.id) }));
}

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newBlockId(taken: readonly string[] = [], random: () => number = Math.random) {
  for (;;) {
    const id = Array.from({ length: 8 }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
    if (!taken.includes(id)) return id;
  }
}

/** Moves one item (keyboard buttons and drag use the same function). Out-of-range moves return the list unchanged. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ---- Publishing ---------------------------------------------------------------------------------------------------------------------------------------------
export type BioIssue = "name" | "photo" | "empty" | "link";
/** What stops a page from being published. Hidden blocks do not count. A profile photo is required (founder decision 25 Nov). */
export function publishIssues(definition: BioDefinition, { hasPhoto }: { hasPhoto: boolean }): BioIssue[] {
  const issues: BioIssue[] = [];
  if (!definition.name.trim()) issues.push("name");
  if (!hasPhoto) issues.push("photo");
  if (!definition.blocks.some((block) => blockShown(definition, block))) issues.push("empty");
  return issues;
}
/** Parses what the editor holds; a null result means a field is invalid (the editor shows which through `fieldIssues`). */
export function parseDefinition(value: unknown) { const parsed = bioDefinitionSchema.safeParse(value); return parsed.success ? parsed.data : null; }

/** Per-field problems of an editor draft, so the screen can mark the exact row. Keys are block ids, `social:<network>`, `detail:<id>` or `tab:<id>`. */
export function fieldIssues(definition: BioDefinition): Record<string, "url" | "required"> {
  const out: Record<string, "url" | "required"> = {};
  // The two original tabs fall back to their default names; a tab the owner added needs a name.
  if (definition.layout === "tabs") for (const t of definition.tabs) if (!t.label.trim() && !isLegacyTabId(t.id)) out[`tab:${t.id}`] = "required";
  for (const block of definition.blocks) {
    if ((block.type === "link" || block.type === "event") && !safeHttpsUrl(block.url)) out[block.id] = "url";
    else if (block.type === "link" && !block.label.trim()) out[block.id] = "required";
    else if (block.type === "event" && (!block.title.trim() || !block.when.trim())) out[block.id] = "required";
    else if ((block.type === "message" || block.type === "giving" || block.type === "form") && !block.title.trim()) out[block.id] = "required";
    else if (block.type === "video" && !validVideo({ provider: block.provider, id: block.videoId })) out[block.id] = "url";
    else if (block.type === "live" && !safeHttpsUrl(block.url)) out[block.id] = "url";
    else if (block.type === "live" && !block.title.trim()) out[block.id] = "required";
    else if (block.type === "contact" && (!optionalEmail.safeParse(block.email).success || !phone.safeParse(block.phone).success || !phone.safeParse(block.whatsapp).success)) out[block.id] = "url";
    else if (block.type === "contact" && !(block.email.trim() || block.phone.trim() || block.whatsapp.trim())) out[block.id] = "required";
    else if (block.type === "location" && !block.address.trim()) out[block.id] = "required";
    else if (block.type === "testimonials" && block.items.some((x) => !x.quote.trim() || !x.name.trim())) out[block.id] = "required";
  }
  for (const social of definition.socials) if (!safeHttpsUrl(social.url)) out[`social:${social.network}`] = "url";
  return out;
}

// ---- What a visitor sees (public page and the live preview) ---------------------------------------------------------------------------------------
export type BioViewBlock =
  | { type: "link"; id: string; label: string; url: string; icon: BioIcon | null }
  | { type: "event"; id: string; title: string; when: string; url: string }
  | { type: "community"; id: string; name: string; tagline: string | null; slug: string }
  | { type: "newsletter"; id: string; slug: string }
  | { type: "message"; id: string; title: string }
  | { type: "giving"; id: string; title: string; methods: GivingPublicMethod[] }
  | { type: "catalog" | "files"; id: string; title: string; items: BioCatalogCard[] }
  | { type: "form"; id: string; title: string; slug: string }
  | { type: "video"; id: string; title: string; video: LessonVideo }
  | { type: "contact"; id: string; email: string; phone: string; whatsapp: string }
  | { type: "location"; id: string; label: string; address: string }
  | { type: "live"; id: string; title: string; url: string }
  | { type: "testimonials"; id: string; items: { id: string; quote: string; name: string; role: string }[] };
/** A product or course as the public page shows it: only fields its own public page shows. */
export type BioCatalogCard = { id: string; kind: "course" | "download"; slug: string; title: string; summary: string };

/** Contact and map addresses a block's buttons open (nothing is fetched by Harvest). */
export const telHref = (value: string) => `tel:${value.trim().startsWith("+") ? "+" : ""}${phoneDigits(value)}`;
export const whatsappHref = (value: string) => `https://wa.me/${phoneDigits(value)}`;
export const mapsHref = (address: string) => `https://www.openstreetmap.org/search?query=${encodeURIComponent(address.trim())}`;
export type BioView = {
  /** `bio` is the one-line short bio under the name. */
  ministryName: string; name: string; bio: string;
  /** Tabs in order. `label` is empty for an original tab that keeps its default name, and for the single-page layout. */
  tabs: { id: BioTabId; label: string; blocks: BioViewBlock[] }[]; layout: BioLayout; showCover: boolean; photoAlign: BioPhotoAlign; iconStyle: BioIconStyle;
  hasPhoto: boolean; hasCover: boolean; scheme: typeof bioSchemes[number]; buttons: typeof bioButtonStyles[number];
  brandTheme: string | null; socials: { network: BioNetwork; url: string }[];
};

/** The "Message me" statement and the fixed notice (founder decision, 22 Nov): shown with the form, never pre-ticked, frozen text per ministry name. */
export const messageNotice = (ministry: string) => `Your details go to ${ministry.trim() || "the ministry"}. You can ask them to delete them.`;

export const bioMessageSchema = z.object({
  proof: z.string().max(160),
  name: z.string().trim().min(1).max(bioLimits.senderName).refine((value) => !/[\u0000-\u001f\u007f<>]/.test(value)),
  email: z.email().max(bioLimits.senderEmail),
  message: z.string().trim().min(1).max(bioLimits.messageBody).refine((value) => !/\u0000/.test(value)),
  consent: z.literal(true),
  website: z.string().max(200).optional(), // Honeypot.
}).strict();
export type BioMessageInput = z.infer<typeof bioMessageSchema>;
