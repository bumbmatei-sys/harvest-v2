import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, blogPosts, blogSettings, users, workspaces } from "../db/schema";
import { message } from "../i18n/messages";
import { blogHandleProblem, blogImageIds, blogLimits, blogPostInput, blogPublishInput, blogSettingsInput, blogSlugProblem, BlogBodyError, derivedExcerpt,
  publishProblems, sanitizeBlogBody, slugFromTitle, type BlogCard, type BlogFeedItem, type BlogIndexView, type BlogLatestPost, type BlogPostView, type BlogStatus } from "../lib/blog";
import { DocContentError, emptyContent, type DocContent } from "../lib/docs";
import { suggestHandle } from "../lib/link-in-bio";
import { timeZoneOrDefault } from "../lib/time-zone";
import { blogEnabled } from "./blog-mode";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

export function requireBlogEnabled() { if (!blogEnabled()) throw new AccessError(404, message("Errors.thisViewIsNotAvailable")); }
const uuid = z.uuid();
const stale = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
const code = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return code(error.cause);
};
const constraint = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return;
  if ("constraint" in error && typeof error.constraint === "string") return error.constraint;
  if ("cause" in error) return constraint(error.cause);
};
const pgMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") return "";
  if ("cause" in error && error.cause) return pgMessage(error.cause) || ("message" in error ? String(error.message) : "");
  return "message" in error ? String(error.message) : "";
};
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const randomSuffix = () => randomBytes(3).toString("hex").slice(0, 4);

// ---- Owner ------------------------------------------------------------------------------------------------------------------------------------------------
export type BlogOwnerSettings = { handle: string; title: string; intro: string | null; version: number; handleLocked: boolean; timeZone: string };
export type BlogListRow = { id: string; title: string; slug: string; status: BlogStatus; publishAt: string | null; publishedAt: string | null; updatedAt: string; author: string | null };
export type BlogOwnerPost = { id: string; version: number; title: string; slug: string; slugLocked: boolean; excerpt: string | null; body: DocContent;
  coverFileId: string | null; shareFileId: string | null; seoTitle: string | null; seoDescription: string | null; status: BlogStatus;
  publishAt: string | null; publishedAt: string | null; updatedAt: string };

async function settingsRow(tx: Transaction, tenantId: string, user: string) {
  const [existing] = await tx.select().from(blogSettings).where(eq(blogSettings.tenantId, tenantId));
  if (existing) return existing;
  const [ministry] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.tenantId, tenantId));
  const name = (ministry?.name ?? "").trim().slice(0, blogLimits.blogTitle) || "Blog";
  const base = suggestHandle(name) || "ministry-blog";
  for (let attempt = 0; attempt < 12; attempt++) {
    const handle = attempt === 0 ? base : `${base.slice(0, 25).replace(/-+$/, "")}-${randomSuffix()}`;
    if (blogHandleProblem(handle)) continue;
    await tx.execute(sql`savepoint blog_create`);
    try {
      const [row] = await tx.insert(blogSettings).values({ tenantId, handle, title: name, createdBy: user }).returning();
      await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "blog.create", targetId: tenantId });
      return row;
    } catch (error) {
      await tx.execute(sql`rollback to savepoint blog_create`);
      if (code(error) !== "23505") throw error;
      const [raced] = await tx.select().from(blogSettings).where(eq(blogSettings.tenantId, tenantId));
      if (raced) return raced;
    }
  }
  throw new AccessError(409, message("Errors.blogHandleTaken"), { reason: "handle_taken" });
}
async function ownerSettings(tx: Transaction, row: typeof blogSettings.$inferSelect): Promise<BlogOwnerSettings> {
  const [locked] = await tx.select({ n: sql<number>`count(*)::int` }).from(blogPosts).where(and(eq(blogPosts.tenantId, row.tenantId), sql`${blogPosts.firstPublishedAt} is not null`));
  const [ministry] = await tx.select({ timeZone: workspaces.timeZone }).from(workspaces).where(eq(workspaces.tenantId, row.tenantId));
  return { handle: row.handle, title: row.title, intro: row.intro, version: row.version, handleLocked: Number(locked?.n ?? 0) > 0, timeZone: timeZoneOrDefault(ministry?.timeZone) };
}
const listColumns = { id: blogPosts.id, title: blogPosts.title, slug: blogPosts.slug, status: blogPosts.status, publishAt: blogPosts.publishAt, publishedAt: blogPosts.publishedAt,
  updatedAt: blogPosts.updatedAt, author: users.name };
const listRow = (r: { id: string; title: string; slug: string; status: BlogStatus; publishAt: Date | null; publishedAt: Date | null; updatedAt: Date; author: string | null }): BlogListRow =>
  ({ id: r.id, title: r.title, slug: r.slug, status: r.status, publishAt: iso(r.publishAt), publishedAt: iso(r.publishedAt), updatedAt: iso(r.updatedAt)!, author: r.author });
const ownerPost = (r: typeof blogPosts.$inferSelect): BlogOwnerPost => ({ id: r.id, version: r.version, title: r.title, slug: r.slug, slugLocked: r.firstPublishedAt !== null,
  excerpt: r.excerpt, body: r.body, coverFileId: r.coverFileId, shareFileId: r.shareFileId, seoTitle: r.seoTitle, seoDescription: r.seoDescription, status: r.status,
  publishAt: iso(r.publishAt), publishedAt: iso(r.publishedAt), updatedAt: iso(r.updatedAt)! });

/** The ministry's blog settings and every article (newest change first), created empty the first time an owner or admin opens it. */
export async function getBlog(db: Database, user: string, workspace: string): Promise<{ settings: BlogOwnerSettings; posts: BlogListRow[] }> {
  requireBlogEnabled();
  return withTenant(db, user, uuid.parse(workspace), "blog:manage", async (tx, tenantId) => {
    const row = await settingsRow(tx, tenantId, user);
    const posts = await tx.select(listColumns).from(blogPosts).leftJoin(users, eq(users.id, blogPosts.createdBy))
      .where(eq(blogPosts.tenantId, tenantId)).orderBy(desc(blogPosts.updatedAt), desc(blogPosts.id)).limit(500);
    return { settings: await ownerSettings(tx, row), posts: posts.map(listRow) };
  });
}

/** Title, intro and the blog's address (fixed once an article has been published; refused when another ministry has it). */
export async function saveBlogSettings(db: Database, user: string, workspace: string, raw: unknown): Promise<BlogOwnerSettings> {
  requireBlogEnabled();
  const input = blogSettingsInput.parse(raw), handle = input.handle.trim().toLowerCase();
  const problem = blogHandleProblem(handle);
  if (problem) throw new AccessError(400, message("Errors.blogHandleInvalid"), { reason: `handle_${problem}` });
  return withTenant(db, user, uuid.parse(workspace), "blog:manage", async (tx, tenantId) => {
    const current = await settingsRow(tx, tenantId, user);
    if (current.version !== input.version) throw stale();
    await tx.execute(sql`savepoint blog_settings`);
    try {
      const [row] = await tx.update(blogSettings).set({ handle, title: input.title, intro: input.intro ?? null, version: current.version + 1, updatedAt: new Date() })
        .where(and(eq(blogSettings.tenantId, tenantId), eq(blogSettings.version, current.version))).returning();
      if (!row) throw stale();
      await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "blog.settings", targetId: tenantId, metadata: { version: String(row.version) } });
      return ownerSettings(tx, row);
    } catch (error) {
      if (code(error) === "23505") { await tx.execute(sql`rollback to savepoint blog_settings`); throw new AccessError(409, message("Errors.blogHandleTaken"), { reason: "handle_taken" }); }
      if (code(error) === "23514" && /fixed/.test(pgMessage(error))) { await tx.execute(sql`rollback to savepoint blog_settings`); throw new AccessError(409, message("Errors.blogHandleLocked"), { reason: "handle_locked" }); }
      throw error;
    }
  });
}

/** A new, empty draft with a temporary address (replaced from the title until the first publish). */
export async function createBlogPost(db: Database, user: string, workspace: string): Promise<BlogOwnerPost> {
  requireBlogEnabled();
  return withTenant(db, user, uuid.parse(workspace), "blog:manage", async (tx, tenantId) => {
    await settingsRow(tx, tenantId, user);
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(blogPosts).where(eq(blogPosts.tenantId, tenantId));
    if (Number(count?.n ?? 0) >= 2000) throw new AccessError(409, message("Errors.blogTooManyPosts"));
    for (let attempt = 0; attempt < 6; attempt++) {
      await tx.execute(sql`savepoint blog_post_create`);
      try {
        const [row] = await tx.insert(blogPosts).values({ tenantId, slug: `draft-${randomSuffix()}${randomSuffix()}`, body: emptyContent(), createdBy: user, updatedBy: user }).returning();
        await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "blog.post.create", targetId: row.id });
        return ownerPost(row);
      } catch (error) {
        await tx.execute(sql`rollback to savepoint blog_post_create`);
        if (code(error) !== "23505") throw error;
      }
    }
    throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"));
  });
}

export async function getBlogPost(db: Database, user: string, workspace: string, postId: string): Promise<{ post: BlogOwnerPost; settings: BlogOwnerSettings }> {
  requireBlogEnabled();
  const id = uuid.parse(postId);
  return withTenant(db, user, uuid.parse(workspace), "blog:manage", async (tx, tenantId) => {
    const settings = await settingsRow(tx, tenantId, user);
    const [row] = await tx.select().from(blogPosts).where(and(eq(blogPosts.tenantId, tenantId), eq(blogPosts.id, id)));
    if (!row) throw new AccessError(404, message("Errors.thisViewIsNotAvailable"));
    return { post: ownerPost(row), settings: await ownerSettings(tx, settings) };
  });
}

function refusedBody(error: unknown): never {
  if (error instanceof BlogBodyError) throw new AccessError(400, message(error.reason === "IMAGES" ? "Errors.blogTooManyImages" : "Errors.checkTheSuppliedDetails"), { reason: "body" });
  if (error instanceof DocContentError) throw new AccessError(400, message(error.reason === "SIZE" ? "Errors.blogBodyTooLarge" : "Errors.checkTheSuppliedDetails"), { reason: "body" });
  throw error;
}
async function writePost(tx: Transaction, tenantId: string, id: string, version: number, values: Partial<typeof blogPosts.$inferInsert>, savepoint: string) {
  await tx.execute(sql.raw(`savepoint ${savepoint}`));
  try {
    const [row] = await tx.update(blogPosts).set({ ...values, version: version + 1, updatedAt: new Date() })
      .where(and(eq(blogPosts.tenantId, tenantId), eq(blogPosts.id, id), eq(blogPosts.version, version))).returning();
    if (!row) throw stale();
    return row;
  } catch (error) {
    if (error instanceof AccessError) throw error;
    const sqlCode = code(error), text = pgMessage(error);
    if (sqlCode === "23505" || sqlCode === "23514" || sqlCode === "23503") await tx.execute(sql.raw(`rollback to savepoint ${savepoint}`));
    if (sqlCode === "23505") throw new AccessError(409, message("Errors.blogSlugTaken"), { reason: "slug_taken" });
    if (sqlCode === "23514" && /address is fixed/.test(text)) throw new AccessError(409, message("Errors.blogSlugLocked"), { reason: "slug_locked" });
    if (sqlCode === "23514" && /picture/.test(text) || sqlCode === "23503") throw new AccessError(400, message("Errors.blogPictureUnavailable"), { reason: "picture" });
    if (sqlCode === "23514" && /publish time/.test(text)) throw new AccessError(400, message("Errors.blogScheduleRange"), { reason: "schedule" });
    if (sqlCode === "23514" && (/cannot change/.test(text) || constraint(error) === "blog_posts_status")) throw stale();
    throw error;
  }
}

/** Saves the article's text and settings. The address can change only until the first publish. */
export async function saveBlogPost(db: Database, user: string, workspace: string, postId: string, raw: unknown): Promise<BlogOwnerPost> {
  requireBlogEnabled();
  const id = uuid.parse(postId), input = blogPostInput.parse(raw);
  let body: DocContent | undefined;
  try { body = input.body === undefined ? undefined : sanitizeBlogBody(input.body); } catch (error) { refusedBody(error); }
  return withTenant(db, user, uuid.parse(workspace), "blog:manage", async (tx, tenantId) => {
    const [current] = await tx.select().from(blogPosts).where(and(eq(blogPosts.tenantId, tenantId), eq(blogPosts.id, id))).for("update");
    if (!current) throw new AccessError(404, message("Errors.thisViewIsNotAvailable"));
    if (input.version !== undefined && current.version !== input.version) throw stale();
    let slug = current.slug;
    if (input.slug !== undefined) {
      const wanted = input.slug.trim().toLowerCase();
      if (wanted !== current.slug) {
        if (current.firstPublishedAt) throw new AccessError(409, message("Errors.blogSlugLocked"), { reason: "slug_locked" });
        const problem = blogSlugProblem(wanted);
        if (problem) throw new AccessError(400, message("Errors.blogSlugInvalid"), { reason: `slug_${problem}` });
        slug = wanted;
      }
    }
    const row = await writePost(tx, tenantId, id, current.version, {
      title: input.title, slug, excerpt: input.excerpt ?? null, seoTitle: input.seoTitle ?? null, seoDescription: input.seoDescription ?? null,
      ...(input.coverFileId !== undefined ? { coverFileId: input.coverFileId } : {}), ...(input.shareFileId !== undefined ? { shareFileId: input.shareFileId } : {}),
      ...(body ? { body, imageIds: blogImageIds(body) } : {}), updatedBy: user,
    }, "blog_post_save");
    await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "blog.post.save", targetId: id, metadata: { version: String(row.version) } });
    return ownerPost(row);
  });
}

/** Publish now, schedule (an instant within the coming year, shown in the ministry's time zone), take a schedule back, or unpublish. */
export async function changeBlogPostState(db: Database, user: string, workspace: string, postId: string, raw: unknown): Promise<BlogOwnerPost> {
  requireBlogEnabled();
  const id = uuid.parse(postId), input = blogPublishInput.parse(raw);
  return withTenant(db, user, uuid.parse(workspace), "blog:manage", async (tx, tenantId) => {
    const [current] = await tx.select().from(blogPosts).where(and(eq(blogPosts.tenantId, tenantId), eq(blogPosts.id, id))).for("update");
    if (!current) throw new AccessError(404, message("Errors.thisViewIsNotAvailable"));
    if (current.version !== input.version) throw stale();
    if (input.action === "publish" || input.action === "schedule") {
      if (current.status === "published") throw stale();
      const problems = publishProblems(current);
      if (problems.length) throw new AccessError(400, message("Errors.blogNotReady"), { reason: `missing_${problems[0]}` });
    }
    if (input.action === "unschedule" && current.status !== "scheduled") throw stale();
    if (input.action === "unpublish" && current.status !== "published") throw stale();
    let values: Partial<typeof blogPosts.$inferInsert>;
    if (input.action === "publish") values = { status: "published", publishedAt: new Date(), publishAt: null, scheduledBy: null };
    else if (input.action === "schedule") {
      const at = new Date(input.at);
      if (!(at.getTime() > Date.now() + 30_000) || at.getTime() > Date.now() + blogLimits.scheduleHorizonDays * 86_400_000) throw new AccessError(400, message("Errors.blogScheduleRange"), { reason: "schedule" });
      values = { status: "scheduled", publishAt: at, publishedAt: null, scheduledBy: user };
    } else values = { status: "draft", publishAt: null, publishedAt: null, scheduledBy: null };
    const row = await writePost(tx, tenantId, id, current.version, { ...values, updatedBy: user }, "blog_post_state");
    await tx.insert(auditLogs).values({ tenantId, actorId: user, action: `blog.post.${input.action}`, targetId: id, metadata: { version: String(row.version) } });
    return ownerPost(row);
  });
}

export async function deleteBlogPost(db: Database, user: string, workspace: string, postId: string, version: unknown): Promise<{ deleted: true }> {
  requireBlogEnabled();
  const id = uuid.parse(postId), expected = z.number().int().min(1).parse(version);
  return withTenant(db, user, uuid.parse(workspace), "blog:manage", async (tx, tenantId) => {
    const [row] = await tx.delete(blogPosts).where(and(eq(blogPosts.tenantId, tenantId), eq(blogPosts.id, id), eq(blogPosts.version, expected))).returning({ id: blogPosts.id });
    if (!row) throw stale();
    await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "blog.post.delete", targetId: id });
    return { deleted: true };
  });
}

/** For the Social Planner: scheduled and published articles whose time falls in [from, to). Empty for anyone who cannot manage the blog. */
export type PlannerArticle = { id: string; title: string; status: "scheduled" | "published"; at: string; slug: string; handle: string };
export async function plannerArticles(db: Database, user: string, workspace: string, range: { from: string; to: string }): Promise<PlannerArticle[]> {
  requireBlogEnabled();
  const from = new Date(z.iso.datetime({ offset: true }).parse(range.from)), to = new Date(z.iso.datetime({ offset: true }).parse(range.to));
  if (!(to > from) || to.getTime() - from.getTime() > 400 * 86_400_000) throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
  return withTenant(db, user, uuid.parse(workspace), "blog:manage", async (tx, tenantId) => {
    const [settings] = await tx.select({ handle: blogSettings.handle }).from(blogSettings).where(eq(blogSettings.tenantId, tenantId));
    if (!settings) return [];
    const rows = await tx.select({ id: blogPosts.id, title: blogPosts.title, slug: blogPosts.slug, status: blogPosts.status, publishAt: blogPosts.publishAt, publishedAt: blogPosts.publishedAt })
      .from(blogPosts).where(and(eq(blogPosts.tenantId, tenantId), or(
        and(eq(blogPosts.status, "scheduled"), gte(blogPosts.publishAt, from), lt(blogPosts.publishAt, to)),
        and(eq(blogPosts.status, "published"), gte(blogPosts.publishedAt, from), lt(blogPosts.publishedAt, to)))))
      .orderBy(asc(sql`coalesce(${blogPosts.publishAt}, ${blogPosts.publishedAt})`), asc(blogPosts.id)).limit(500);
    return rows.map((r) => ({ id: r.id, title: r.title, slug: r.slug, handle: settings.handle, status: r.status as "scheduled" | "published", at: iso(r.status === "scheduled" ? r.publishAt : r.publishedAt)! }));
  });
}

// ---- Public -----------------------------------------------------------------------------------------------------------------------------------------------
type RawCard = { slug: string; title: string; excerpt: string | null; publishedAt: string; coverId: string | null; lead: string; words: number };
const card = (raw: RawCard): BlogCard => ({ slug: raw.slug, title: raw.title, excerpt: derivedExcerpt(raw.excerpt, { type: "doc", content: [{ type: "paragraph", content: raw.lead ? [{ type: "text", text: raw.lead }] : [] }] }),
  publishedAt: iso(raw.publishedAt)!, hasCover: Boolean(raw.coverId), coverId: raw.coverId, readingMinutes: raw.words === 0 ? 0 : Math.max(1, Math.ceil(raw.words / 200)) });
const handleOk = (handle: string) => /^[a-z0-9-]{3,30}$/.test(handle);
async function definer<T>(db: Database, query: ReturnType<typeof sql>): Promise<T | null> {
  return db.transaction(async (tx) => (await tx.execute<{ v: T | null }>(query)).rows[0]?.v ?? null);
}

/** A page of the blog's published articles, newest first. Null for an unknown address or a page past the end (other than the first). */
export async function publicBlogIndex(db: Database, handle: string, page = 1): Promise<BlogIndexView | null> {
  if (!blogEnabled() || !handleOk(handle) || !Number.isInteger(page) || page < 1 || page > 10_000) return null;
  const raw = await definer<{ handle: string; title: string; intro: string | null; total: number; posts: RawCard[] }>(db, sql`select public.blog_public_index(${handle}, ${page}, ${blogLimits.pageSize}) as v`);
  if (!raw) return null;
  const pages = Math.max(1, Math.ceil(raw.total / blogLimits.pageSize));
  if (page > pages) return null;
  return { handle: raw.handle, title: raw.title, intro: raw.intro, page, pages, total: raw.total, posts: raw.posts.map(card) };
}

/** One published article with up to three more. Null when it is not published (draft, scheduled, unknown: the same answer). */
export async function publicBlogPost(db: Database, handle: string, slug: string): Promise<BlogPostView | null> {
  if (!blogEnabled() || !handleOk(handle) || !/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const raw = await definer<RawCard & { body: DocContent; seoTitle: string | null; seoDescription: string | null; shareId: string | null; updatedAt: string; blog: { handle: string; title: string }; more: RawCard[] }>(db,
    sql`select public.blog_public_post(${handle}, ${slug}) as v`);
  if (!raw) return null;
  let body: DocContent;
  try { body = sanitizeBlogBody(raw.body); } catch { body = emptyContent(); }
  return { ...card(raw), body, seoTitle: raw.seoTitle, seoDescription: raw.seoDescription, shareId: raw.shareId, updatedAt: iso(raw.updatedAt)!, blog: raw.blog, more: raw.more.map(card) };
}

/** The feed's blog and newest articles (with bodies). Null for an unknown address. */
export async function publicBlogFeed(db: Database, handle: string): Promise<{ handle: string; title: string; intro: string | null; items: BlogFeedItem[] } | null> {
  if (!blogEnabled() || !handleOk(handle)) return null;
  const raw = await definer<{ handle: string; title: string; intro: string | null; items: (Omit<BlogFeedItem, "excerpt"> & { excerpt: string | null })[] }>(db, sql`select public.blog_public_feed(${handle}, ${blogLimits.feedItems}) as v`);
  if (!raw) return null;
  return { handle: raw.handle, title: raw.title, intro: raw.intro, items: raw.items.map((item) => {
    let body: DocContent;
    try { body = sanitizeBlogBody(item.body); } catch { body = emptyContent(); }
    return { slug: item.slug, title: item.title, excerpt: derivedExcerpt(item.excerpt, body), publishedAt: iso(item.publishedAt)!, updatedAt: iso(item.updatedAt)!, body };
  }) };
}

/** A picture of a published article, for the signed redirect. Null otherwise. */
export async function publicBlogImage(db: Database, handle: string, fileId: string): Promise<{ key: string; name: string; mime: string } | null> {
  if (!blogEnabled() || !handleOk(handle) || !uuid.safeParse(fileId).success) return null;
  return definer(db, sql`select public.blog_public_image(${handle}, ${fileId}::uuid) as v`);
}

/**
 * Interface for the link-in-bio "blog" block: a ministry's newest published articles (`limit`, 1 to 12), or the chosen ones by address in the given order.
 * Published content only, so the public page and the owner's preview can both call it. An empty list when the ministry has no blog or the module is off.
 */
export async function latestBlogPosts(db: Database, tenantId: string, options: { limit?: number; slugs?: readonly string[] } = {}): Promise<BlogLatestPost[]> {
  if (!blogEnabled() || !uuid.safeParse(tenantId).success) return [];
  const limit = Math.min(blogLimits.latest, Math.max(1, Math.trunc(options.limit ?? 3)));
  const slugs = (options.slugs ?? []).filter((s) => blogSlugProblem(s) === null).slice(0, blogLimits.latest);
  const raw = await definer<(RawCard & { handle: string })[]>(db, sql`select public.blog_public_latest(${tenantId}::uuid, ${limit}, ${slugs.length ? sql`array[${sql.join(slugs.map((s) => sql`${s}`), sql`, `)}]::text[]` : sql`null::text[]`}) as v`);
  return (raw ?? []).map((r) => { const c = card(r); return { handle: r.handle, slug: c.slug, title: c.title, excerpt: c.excerpt, publishedAt: c.publishedAt, coverId: c.coverId, path: `/blog/${r.handle}/${c.slug}` }; });
}

/** A new article's address from its title, made unique within the ministry (for the editor's first save). */
export async function suggestBlogSlug(db: Database, user: string, workspace: string, title: string, postId: string): Promise<string> {
  requireBlogEnabled();
  const id = uuid.parse(postId), base = slugFromTitle(title, 70) || "article";
  return withTenant(db, user, uuid.parse(workspace), "blog:manage", async (tx, tenantId) => {
    const taken = new Set((await tx.select({ slug: blogPosts.slug }).from(blogPosts).where(and(eq(blogPosts.tenantId, tenantId), sql`${blogPosts.id} <> ${id}`,
      or(eq(blogPosts.slug, base), sql`${blogPosts.slug} like ${`${base}-%`}`)))).map((r) => r.slug));
    if (!taken.has(base)) return base;
    for (let n = 2; n < 100; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
    return `${base}-${randomSuffix()}`;
  });
}
