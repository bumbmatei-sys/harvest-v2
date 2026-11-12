import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { communities, communityCategories, communityComments, communityFiles, communityLikes, communityMemberships, communityPosts, users } from "../db/schema";
import { commentInput, forumSorts, postInput, type ForumSort } from "../lib/forum";
import { plainText, sanitizeRichText, type RichDoc } from "../lib/rich-text";
import { videoEmbed } from "../lib/video-embed";
import { communityCan } from "../lib/community-permissions";
import { message } from "../i18n/messages";
import { communitySlug } from "./communities";
import { AccessError } from "./permissions";
import { withUser } from "./tenancy";

// PR 4b (C09/C10): the member forum. Reads run in withUser through community_can_read (RLS); every write goes
// through a definer in migration 0038, which re-checks membership, roles, hosts-only categories and switches.
export type ForumContext = { id: string; tenantId: string; slug: string; name: string; description: string | null; rulesList: string[]; role: string;
  canModerate: boolean; mutedUntil: Date | null; categories: { id: string; name: string; emoji: string | null; hostsOnly: boolean }[] };

const notFound = () => new AccessError(404, message("Errors.communityNotFound"));
const readable = async (tx: Transaction, tenantId: string, communityId: string) =>
  (await tx.execute<{ ok: boolean }>(sql`select public.community_can_read(${tenantId}::uuid, ${communityId}::uuid) as ok`)).rows[0]?.ok === true;

async function context(tx: Transaction, userId: string, slug: string): Promise<ForumContext | null> {
  const parsed = communitySlug.safeParse(slug);
  if (!parsed.success) return null;
  // communities_member: visible only through the caller's active membership.
  const [row] = await tx.select({ id: communities.id, tenantId: communities.tenantId, slug: communities.slug, name: communities.name, description: communities.description,
    rulesList: communities.rulesList, status: communities.status, role: communityMemberships.role, mutedUntil: communityMemberships.mutedUntil })
    .from(communities).innerJoin(communityMemberships, and(eq(communityMemberships.tenantId, communities.tenantId), eq(communityMemberships.communityId, communities.id)))
    .where(and(eq(communities.slug, parsed.data), eq(communityMemberships.userId, userId), eq(communityMemberships.status, "active")));
  if (!row || row.status !== "published" || !(await readable(tx, row.tenantId, row.id))) return null;
  const categories = await tx.select({ id: communityCategories.id, name: communityCategories.name, emoji: communityCategories.emoji, hostsOnly: communityCategories.hostsOnly })
    .from(communityCategories).where(eq(communityCategories.communityId, row.id)).orderBy(asc(communityCategories.position), asc(communityCategories.createdAt));
  return { id: row.id, tenantId: row.tenantId, slug: row.slug, name: row.name, description: row.description, rulesList: row.rulesList, role: row.role,
    canModerate: communityCan(row.role, "community:moderate"), mutedUntil: row.mutedUntil && row.mutedUntil > new Date() ? row.mutedUntil : null, categories };
}

/** The member's view of a community, or null when they may not read it (all callers answer 404). */
export { context as forumContextTx };
export function forumContext(db: Database, userId: string, slug: string) { return withUser(db, userId, (tx) => context(tx, userId, slug)); }

export type PostSummary = { id: string; title: string; excerpt: string; authorId: string | null; authorName: string | null; categoryId: string; pinned: boolean;
  createdAt: Date; editedAt: Date | null; likes: number; comments: number; liked: boolean; likesOff: boolean; coverFileId: string | null; hasVideo: boolean; held: boolean };

const likeCount = (target: "post" | "comment", idColumn: typeof communityPosts.id | typeof communityComments.id, since?: Date) =>
  sql<number>`(select count(*)::int from ${communityLikes} l where l.target_type = ${target} and l.target_id = ${idColumn}${since ? sql` and l.created_at >= ${since}` : sql``})`;
const likedBy = (target: "post" | "comment", idColumn: typeof communityPosts.id | typeof communityComments.id, userId: string) =>
  sql<boolean>`exists (select 1 from ${communityLikes} l where l.target_type = ${target} and l.target_id = ${idColumn} and l.user_id = ${userId})`;

const listInput = z.object({ category: z.uuid().optional(), sort: z.enum(forumSorts).default("new"), page: z.coerce.number().int().min(1).max(1000).default(1) }).strict();
export const forumPageSize = 50;

export async function listPosts(db: Database, userId: string, slug: string, raw: unknown = {}) {
  const input = listInput.parse(raw);
  return withUser(db, userId, async (tx) => {
    const ctx = await context(tx, userId, slug);
    if (!ctx) throw notFound();
    const week = new Date(Date.now() - 7 * 864e5), best = likeCount("post", communityPosts.id, week);
    const rows = await tx.select({ id: communityPosts.id, title: communityPosts.title, bodyText: communityPosts.bodyText, authorId: communityPosts.authorId, authorName: users.name,
      categoryId: communityPosts.categoryId, pinned: communityPosts.pinned, createdAt: communityPosts.createdAt, editedAt: communityPosts.editedAt,
      likes: likeCount("post", communityPosts.id), liked: likedBy("post", communityPosts.id, userId), likesOff: communityPosts.likesOff,
      comments: sql<number>`(select count(*)::int from ${communityComments} c where c.post_id = ${communityPosts.id} and c.removed_at is null and c.held_at is null)`,
      coverFileId: communityPosts.coverFileId, videoUrl: communityPosts.videoUrl, held: sql<boolean>`${communityPosts.heldAt} is not null` })
      .from(communityPosts).leftJoin(users, eq(users.id, communityPosts.authorId))
      // Held posts (C12a) are listed only for their author; hosts review them in the moderation page.
      .where(and(eq(communityPosts.communityId, ctx.id), isNull(communityPosts.removedAt), or(isNull(communityPosts.heldAt), eq(communityPosts.authorId, userId)),
        input.category ? eq(communityPosts.categoryId, input.category) : undefined))
      .orderBy(...(input.sort === "best" ? [desc(best), desc(communityPosts.createdAt)] : [desc(communityPosts.pinned), desc(communityPosts.createdAt)]))
      .limit(forumPageSize + 1).offset((input.page - 1) * forumPageSize);
    const hasMore = rows.length > forumPageSize;
    return { context: ctx, sort: input.sort as ForumSort, page: input.page, hasMore, posts: rows.slice(0, forumPageSize).map(({ bodyText, videoUrl, ...row }): PostSummary => ({ ...row,
      excerpt: bodyText.replace(/\s+/g, " ").slice(0, 220), hasVideo: Boolean(videoUrl) })) };
  });
}

export async function getPost(db: Database, userId: string, slug: string, postId: string) {
  const id = z.uuid().safeParse(postId);
  if (!id.success) throw notFound();
  return withUser(db, userId, async (tx) => {
    const ctx = await context(tx, userId, slug);
    if (!ctx) throw notFound();
    const [post] = await tx.select({ id: communityPosts.id, title: communityPosts.title, body: communityPosts.body, authorId: communityPosts.authorId, authorName: users.name,
      categoryId: communityPosts.categoryId, pinned: communityPosts.pinned, createdAt: communityPosts.createdAt, editedAt: communityPosts.editedAt, videoUrl: communityPosts.videoUrl,
      coverFileId: communityPosts.coverFileId, commentsOff: communityPosts.commentsOff, likesOff: communityPosts.likesOff,
      likes: likeCount("post", communityPosts.id), liked: likedBy("post", communityPosts.id, userId), held: sql<boolean>`${communityPosts.heldAt} is not null` })
      .from(communityPosts).leftJoin(users, eq(users.id, communityPosts.authorId))
      .where(and(eq(communityPosts.communityId, ctx.id), eq(communityPosts.id, id.data), isNull(communityPosts.removedAt),
        ctx.canModerate ? undefined : or(isNull(communityPosts.heldAt), eq(communityPosts.authorId, userId))));
    if (!post) throw notFound();
    const attachments = await tx.select({ id: communityFiles.id, name: communityFiles.name, mime: communityFiles.mime, size: communityFiles.size })
      .from(communityFiles).where(and(eq(communityFiles.postId, post.id), eq(communityFiles.kind, "attachment"), eq(communityFiles.status, "ready")))
      .orderBy(asc(communityFiles.createdAt));
    const comments = await tx.select({ id: communityComments.id, body: communityComments.body, authorId: communityComments.authorId, authorName: users.name,
      createdAt: communityComments.createdAt, updatedAt: communityComments.updatedAt, likes: likeCount("comment", communityComments.id),
      liked: likedBy("comment", communityComments.id, userId), held: sql<boolean>`${communityComments.heldAt} is not null`,
      // C12b: previous versions are readable only by hosts (RLS), so everyone else counts zero.
      edits: sql<number>`(select count(*)::int from community_comment_revisions r where r.comment_id = ${communityComments.id})` })
      .from(communityComments).leftJoin(users, eq(users.id, communityComments.authorId))
      .where(and(eq(communityComments.postId, post.id), isNull(communityComments.removedAt),
        ctx.canModerate ? undefined : or(isNull(communityComments.heldAt), eq(communityComments.authorId, userId))))
      .orderBy(asc(communityComments.createdAt)).limit(500);
    // Rendered content is re-sanitized on every read: stored JSON is never trusted as markup.
    const body: RichDoc = sanitizeRichText(post.body) ?? { type: "doc", content: [{ type: "paragraph" }] };
    return { context: ctx, post: { ...post, body, video: post.videoUrl ? videoEmbed(post.videoUrl) : null }, attachments, comments };
  });
}

type Outcome = { outcome: string; id: string | null };
const refusal = (outcome: string) => outcome === "forbidden" ? new AccessError(403, message("Errors.forumActionNotAllowed"))
  : outcome === "muted" ? new AccessError(403, message("Errors.forumMuted"))
  : outcome === "duplicate" ? new AccessError(409, message("Errors.reportDuplicate"))
  : outcome === "invalid" ? new AccessError(400, message("Errors.forumInputInvalid")) : notFound();
export async function forumDefiner(db: Database, userId: string, statement: ReturnType<typeof sql>, ok: string[] = ["ok"], refusals: Partial<Record<string, () => AccessError>> = {}) {
  const result = await withUser(db, userId, async (tx) => (await tx.execute<{ v: Outcome }>(statement)).rows[0].v);
  if (!ok.includes(result.outcome)) throw (refusals[result.outcome] ?? (() => refusal(result.outcome)))();
  return result;
}

/** Create a post, or edit the caller's own post (postId). Rich text and video links are validated here first. */
export async function savePost(db: Database, userId: string, slug: string, raw: unknown, postId?: string) {
  const input = postInput.parse(raw), parsed = communitySlug.parse(slug), id = postId ? z.uuid().parse(postId) : null;
  const body = sanitizeRichText(input.body);
  if (!body) throw new AccessError(400, message("Errors.forumBodyInvalid"));
  const video = input.videoUrl ? input.videoUrl.trim() : null;
  if (video && !videoEmbed(video)) throw new AccessError(400, message("Errors.forumVideoInvalid"));
  const attachments = `{${input.attachmentIds.join(",")}}`;
  return forumDefiner(db, userId, sql`select public.community_post_save(${parsed}, ${id}::uuid, ${input.categoryId}::uuid, ${input.title}, ${JSON.stringify(body)}::jsonb,
    ${plainText(body).slice(0, 20000)}, ${video}, ${input.coverFileId ?? null}::uuid, ${attachments}::uuid[], ${input.commentsOff}, ${input.likesOff}) as v`, ["ok", "held"]);
}

export function deletePost(db: Database, userId: string, slug: string, postId: string) {
  return forumDefiner(db, userId, sql`select public.community_post_delete(${communitySlug.parse(slug)}, ${z.uuid().parse(postId)}::uuid) as v`);
}

export function saveComment(db: Database, userId: string, slug: string, postId: string, raw: unknown, commentId?: string) {
  const { body } = commentInput.parse(raw);
  return forumDefiner(db, userId, sql`select public.community_comment_save(${communitySlug.parse(slug)}, ${z.uuid().parse(postId)}::uuid,
    ${commentId ? z.uuid().parse(commentId) : null}::uuid, ${body}) as v`, ["ok", "held"]);
}

export function deleteComment(db: Database, userId: string, slug: string, commentId: string) {
  return forumDefiner(db, userId, sql`select public.community_comment_delete(${communitySlug.parse(slug)}, ${z.uuid().parse(commentId)}::uuid) as v`);
}

const likeInput = z.object({ targetType: z.enum(["post", "comment"]), targetId: z.uuid() }).strict();
export async function toggleLike(db: Database, userId: string, slug: string, raw: unknown) {
  const input = likeInput.parse(raw);
  const result = await forumDefiner(db, userId, sql`select public.community_like_toggle(${communitySlug.parse(slug)}, ${input.targetType}, ${input.targetId}::uuid) as v`, ["liked", "unliked"]);
  return { liked: result.outcome === "liked" };
}

const moderateInput = z.object({ action: z.enum(["pin", "unpin", "remove_post", "remove_comment"]), targetId: z.uuid() }).strict();
export function moderate(db: Database, userId: string, slug: string, raw: unknown) {
  const input = moderateInput.parse(raw);
  return forumDefiner(db, userId, sql`select public.community_moderate(${communitySlug.parse(slug)}, ${input.action}, ${input.targetId}::uuid) as v`);
}

export type DirectoryMember = { userId: string; name: string; role: string; joinedAt: string | null };
export async function memberDirectory(db: Database, userId: string, slug: string) {
  return withUser(db, userId, async (tx) => {
    const ctx = await context(tx, userId, slug);
    if (!ctx) throw notFound();
    const members = (await tx.execute<{ v: DirectoryMember }>(sql`select public.community_member_directory(${ctx.slug}) as v`)).rows.map((r) => r.v);
    return { context: ctx, members };
  });
}
