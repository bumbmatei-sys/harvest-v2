// Native blog: pure rules shared by the server, the editor and the public pages (addresses, limits, the article body, the search preview, RSS).
// No imports from the server or the database. The body is Docs content (the same editor and sanitiser) plus one blog-only node, `blogImage`,
// which names a ready picture from the ministry's Files by id; the public page resolves it to a short signed address.
import { z } from "zod";
import { contentStats, docText, emptyContent, sanitizeDocContent, type AttrRules, type DocContent, type DocNode } from "./docs";
import { bioReservedHandles } from "./link-in-bio";

export const blogStatuses = ["draft", "scheduled", "published"] as const;
export type BlogStatus = (typeof blogStatuses)[number];
export const blogLimits = { title: 200, excerpt: 300, seoTitle: 70, seoDescription: 160, blogTitle: 100, intro: 500, alt: 200, images: 50, pageSize: 12, feedItems: 20, latest: 12, scheduleHorizonDays: 366 } as const;

// ---- Addresses ----------------------------------------------------------------------------------------------------------------------------------------
/** The blog's address: /blog/<handle>. Same shape as a link-in-bio handle (3 to 30 lower-case letters, digits, single hyphens). */
const handlePattern = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
/** Route names and words that would read as Harvest itself. Repeated in `public.blog_handle_valid` (migration 0135); a unit test keeps them in step. */
export const blogReservedHandles = [...new Set([...bioReservedHandles, "blog", "blogs", "rss", "feed", "images", "articles"])].sort();
export type HandleProblem = "length" | "characters" | "reserved";
export function blogHandleProblem(value: string): HandleProblem | null {
  if (value.length < 3 || value.length > 30) return "length";
  if (!handlePattern.test(value) || value.includes("--")) return "characters";
  if (blogReservedHandles.includes(value)) return "reserved";
  return null;
}
export const blogHandleSchema = z.string().trim().toLowerCase().refine((value) => blogHandleProblem(value) === null);

/** An article's address inside the blog: /blog/<handle>/<slug>. 1 to 80 characters; fixed once first published. */
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
export const blogReservedSlugs = ["rss", "feed", "images", "page"] as const;
export function blogSlugProblem(value: string): HandleProblem | null {
  if (value.length < 1 || value.length > 80) return "length";
  if (!slugPattern.test(value) || value.includes("--")) return "characters";
  if ((blogReservedSlugs as readonly string[]).includes(value)) return "reserved";
  return null;
}
export const blogSlugSchema = z.string().trim().toLowerCase().refine((value) => blogSlugProblem(value) === null);
/** A slug from a title: lower-case words joined by single hyphens (accents removed), at most 80 characters. Empty when nothing usable is left. */
export function slugFromTitle(title: string, max = 80) {
  const base = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
  return blogSlugProblem(base) === null ? base : "";
}
export const blogPath = (handle: string, slug?: string) => slug ? `/blog/${handle}/${slug}` : `/blog/${handle}`;

// ---- Body ---------------------------------------------------------------------------------------------------------------------------------------------
const uuid = z.uuid();
/** The blog-only node: a picture from the ministry's Files, by id, with alternative text. */
export const blogImageRules: AttrRules = {
  fileId: (v) => typeof v === "string" && uuid.safeParse(v).success ? v.toLowerCase() : undefined,
  alt: (v) => typeof v === "string" && v.length <= blogLimits.alt ? v.trim() : undefined,
};
/** Sanitises an article body (Docs rules plus `blogImage`). A picture without a valid file id is refused. Throws DocContentError. */
export function sanitizeBlogBody(input: unknown): DocContent {
  const clean = sanitizeDocContent(input ?? emptyContent(), { blogImage: blogImageRules });
  const ids = blogImageIds(clean);
  if (ids.length > blogLimits.images) throw new BlogBodyError("IMAGES");
  const missing = (node: DocNode): boolean => (node.type === "blogImage" && !node.attrs?.fileId) || (node.content ?? []).some(missing);
  if ((clean.content ?? []).some(missing)) throw new BlogBodyError("IMAGE");
  return clean;
}
export class BlogBodyError extends Error { constructor(public reason: "IMAGES" | "IMAGE") { super("BLOG_BODY_REFUSED"); } }
/** The distinct file ids of the pictures in a body, in order of appearance. */
export function blogImageIds(body: DocContent | null | undefined): string[] {
  const out: string[] = [];
  const walk = (node: DocNode) => { if (node.type === "blogImage" && typeof node.attrs?.fileId === "string" && !out.includes(node.attrs.fileId)) out.push(node.attrs.fileId); node.content?.forEach(walk); };
  (body?.content ?? []).forEach(walk);
  return out;
}
const squash = (text: string) => text.replace(/\s+/g, " ").trim();
/** Cuts text at a word boundary to at most `max` characters, adding an ellipsis when it was cut. */
export function clip(text: string, max: number) {
  const value = squash(text);
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1), space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}
/** The excerpt shown on cards, in the feed and as the default search description: the owner's excerpt, else the start of the body. */
export const derivedExcerpt = (excerpt: string | null | undefined, body: DocContent | null | undefined) => squash(excerpt ?? "") || clip(docText(body), 200);
export const readingMinutes = (body: DocContent | null | undefined) => contentStats(body).readingMinutes;

// ---- Search result preview ------------------------------------------------------------------------------------------------------------------------------
/** What a search engine is likely to show: the SEO title (else the title), the address, and the SEO description (else the excerpt), clipped. */
export function searchPreview(input: { title: string; seoTitle?: string | null; seoDescription?: string | null; excerpt?: string | null; body?: DocContent | null; url: string }) {
  return { title: clip(squash(input.seoTitle ?? "") || squash(input.title) || "", 60), url: input.url.replace(/^https?:\/\//, "").replace(/\//g, " › "),
    description: clip(squash(input.seoDescription ?? "") || derivedExcerpt(input.excerpt, input.body ?? null), 160) };
}

// ---- Owner input ----------------------------------------------------------------------------------------------------------------------------------------
const optionalText = (max: number) => z.string().max(max * 4).transform((v) => v.trim()).refine((v) => v.length <= max).transform((v) => v || null).nullable().optional();
export const blogPostInput = z.object({
  version: z.number().int().min(1).optional(),
  title: z.string().max(blogLimits.title * 4).transform((v) => v.trim()).refine((v) => v.length <= blogLimits.title),
  slug: z.string().max(200).optional(),
  excerpt: optionalText(blogLimits.excerpt), seoTitle: optionalText(blogLimits.seoTitle), seoDescription: optionalText(blogLimits.seoDescription),
  coverFileId: z.uuid().nullable().optional(), shareFileId: z.uuid().nullable().optional(),
  body: z.unknown().optional(),
  harvestPage: z.boolean().optional(),
}).strict();
export type BlogPostInput = z.input<typeof blogPostInput>;
export const blogSettingsInput = z.object({
  version: z.number().int().min(1), handle: z.string().max(100),
  title: z.string().max(blogLimits.blogTitle * 4).transform((v) => v.trim()).refine((v) => v.length >= 1 && v.length <= blogLimits.blogTitle),
  intro: optionalText(blogLimits.intro),
}).strict();
export const blogPublishInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish"), version: z.number().int().min(1) }).strict(),
  z.object({ action: z.literal("schedule"), version: z.number().int().min(1), at: z.iso.datetime({ offset: true }) }).strict(),
  z.object({ action: z.literal("unschedule"), version: z.number().int().min(1) }).strict(),
  z.object({ action: z.literal("unpublish"), version: z.number().int().min(1) }).strict(),
]);
/** What must be filled in before an article can be published or scheduled. */
export function publishProblems(post: { title: string; slug: string; body: DocContent | null }): ("title" | "slug" | "body")[] {
  const out: ("title" | "slug" | "body")[] = [];
  if (!post.title.trim()) out.push("title");
  if (blogSlugProblem(post.slug)) out.push("slug");
  if (!docText(post.body).trim() && blogImageIds(post.body).length === 0) out.push("body");
  return out;
}

// ---- Public views ---------------------------------------------------------------------------------------------------------------------------------------
export type BlogCard = { slug: string; title: string; excerpt: string; publishedAt: string; hasCover: boolean; coverId: string | null; readingMinutes: number };
export type BlogIndexView = { handle: string; title: string; intro: string | null; page: number; pages: number; total: number; posts: BlogCard[] };
export type BlogPostView = BlogCard & { body: DocContent; seoTitle: string | null; seoDescription: string | null; shareId: string | null; updatedAt: string;
  blog: { handle: string; title: string }; more: BlogCard[] };
export type BlogFeedItem = { slug: string; title: string; excerpt: string; publishedAt: string; updatedAt: string; body: DocContent };
/** One published post for the link-in-bio "blog" block. */
export type BlogLatestPost = { handle: string; slug: string; title: string; excerpt: string; publishedAt: string; coverId: string | null; path: string };

// ---- RSS 2.0 --------------------------------------------------------------------------------------------------------------------------------------------
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
/**
 * An RSS 2.0 document (with the Atom self link). Every value is escaped; the full article is in content:encoded as escaped HTML that the caller built from
 * the sanitised body. Dates are RFC 822 (UTC).
 */
export function rssDocument(input: { title: string; description: string | null; link: string; self: string; items: { title: string; link: string; description: string; html: string; publishedAt: string }[]; updatedAt?: string }) {
  const rfc822 = (iso: string) => new Date(iso).toUTCString();
  const items = input.items.map((item) => [
    "<item>", `<title>${xml(item.title)}</title>`, `<link>${xml(item.link)}</link>`, `<guid isPermaLink="true">${xml(item.link)}</guid>`,
    `<pubDate>${rfc822(item.publishedAt)}</pubDate>`, `<description>${xml(item.description)}</description>`, `<content:encoded>${xml(item.html)}</content:encoded>`, "</item>",
  ].join(""));
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    "<channel>", `<title>${xml(input.title)}</title>`, `<link>${xml(input.link)}</link>`, `<description>${xml(input.description || input.title)}</description>`,
    `<atom:link href="${xml(input.self)}" rel="self" type="application/rss+xml"/>`, "<language>en</language>",
    ...(input.updatedAt ? [`<lastBuildDate>${rfc822(input.updatedAt)}</lastBuildDate>`] : []), ...items, "</channel>", "</rss>"].join("\n");
}
