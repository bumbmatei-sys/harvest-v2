import { z } from "zod";

// Link in bio: one public page per ministry (docs/plans/link-in-bio.md). Everything here is pure: the draft definition, its limits, the handle rules and the
// projection the public page and the owner's live preview share. Nothing here reads or stores anything.

export const bioLimits = { blocks: 20, socials: 8, name: 100, bio: 500, label: 80, url: 2048, eventTitle: 100, eventWhen: 60, messageTitle: 60,
  senderName: 100, senderEmail: 254, messageBody: 2000 } as const;

/** Link icons (an allow-list, drawn by the screen). */
export const bioIcons = ["globe", "mail", "phone", "heart", "book", "calendar", "video", "music", "map", "gift"] as const;
export type BioIcon = typeof bioIcons[number];
export const bioNetworks = ["instagram", "facebook", "youtube", "x", "tiktok", "linkedin", "threads", "whatsapp", "podcast", "website"] as const;
export type BioNetwork = typeof bioNetworks[number];
export const bioSchemes = ["auto", "light", "dark"] as const;
export const bioButtonStyles = ["filled", "outline"] as const;

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
const signupSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/);

export const bioBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("link"), id: blockId, hidden: z.boolean(), label: trimmed(bioLimits.label), url: httpsUrl, icon: z.enum(bioIcons).nullable() }).strict(),
  z.object({ type: z.literal("message"), id: blockId, hidden: z.boolean(), title: trimmed(bioLimits.messageTitle) }).strict(),
  z.object({ type: z.literal("event"), id: blockId, hidden: z.boolean(), title: trimmed(bioLimits.eventTitle), when: trimmed(bioLimits.eventWhen), url: httpsUrl }).strict(),
  z.object({ type: z.literal("community"), id: blockId, hidden: z.boolean(), communityId: z.uuid() }).strict(),
  z.object({ type: z.literal("newsletter"), id: blockId, hidden: z.boolean(), slug: signupSlug }).strict(),
]);
export type BioBlock = z.infer<typeof bioBlockSchema>;
export type BioBlockType = BioBlock["type"];

export const bioDefinitionSchema = z.object({
  kind: z.literal("bio-v1"),
  name: plain(bioLimits.name).transform((value) => value.trim()),
  bio: plain(bioLimits.bio).transform((value) => value.trim()),
  scheme: z.enum(bioSchemes),
  buttons: z.enum(bioButtonStyles),
  socials: z.array(z.object({ network: z.enum(bioNetworks), url: httpsUrl }).strict()).max(bioLimits.socials)
    .refine((list) => new Set(list.map((item) => item.network)).size === list.length),
  blocks: z.array(bioBlockSchema).max(bioLimits.blocks)
    .refine((list) => new Set(list.map((block) => block.id)).size === list.length)
    .refine((list) => list.filter((block) => block.type === "message").length <= 1),
}).strict();
export type BioDefinition = z.infer<typeof bioDefinitionSchema>;

export const emptyBioDefinition = (name = ""): BioDefinition => ({ kind: "bio-v1", name: name.slice(0, bioLimits.name), bio: "", scheme: "auto", buttons: "filled", socials: [], blocks: [] });

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
export type BioIssue = "name" | "empty" | "link";
/** What stops a page from being published. Hidden blocks do not count. */
export function publishIssues(definition: BioDefinition): BioIssue[] {
  const issues: BioIssue[] = [];
  if (!definition.name.trim()) issues.push("name");
  if (!definition.blocks.some((block) => !block.hidden)) issues.push("empty");
  return issues;
}
/** Parses what the editor holds; a null result means a field is invalid (the editor shows which through `fieldIssues`). */
export function parseDefinition(value: unknown) { const parsed = bioDefinitionSchema.safeParse(value); return parsed.success ? parsed.data : null; }

/** Per-field problems of an editor draft, so the screen can mark the exact row. Keys are block ids, `social:<network>` or `name`. */
export function fieldIssues(definition: BioDefinition): Record<string, "url" | "required"> {
  const out: Record<string, "url" | "required"> = {};
  for (const block of definition.blocks) {
    if ((block.type === "link" || block.type === "event") && !safeHttpsUrl(block.url)) out[block.id] = "url";
    else if (block.type === "link" && !block.label.trim()) out[block.id] = "required";
    else if (block.type === "event" && (!block.title.trim() || !block.when.trim())) out[block.id] = "required";
    else if (block.type === "message" && !block.title.trim()) out[block.id] = "required";
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
  | { type: "message"; id: string; title: string };
export type BioView = {
  ministryName: string; name: string; bio: string; hasPhoto: boolean; scheme: typeof bioSchemes[number]; buttons: typeof bioButtonStyles[number];
  brandTheme: string | null; socials: { network: BioNetwork; url: string }[]; blocks: BioViewBlock[];
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
