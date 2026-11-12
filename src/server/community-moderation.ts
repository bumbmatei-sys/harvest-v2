import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { communityComments, communityModerationActions, communityPosts, communityReports, users } from "../db/schema";
import { memberActions, muteDays, reportReasons, reportTargets, type ReportReason, type ReportTarget } from "../lib/moderation";
import { message } from "../i18n/messages";
import { communitySlug } from "./communities";
import { forumContextTx, forumDefiner, type ForumContext } from "./community-forum";
import { AccessError } from "./permissions";
import { withUser } from "./tenancy";

// C12a: member reports and the hosts' moderation page. Reads run in withUser: reports and moderation actions are
// readable only by hosts (community_is_host); every write goes through a definer in migration 0039.
const notFound = () => new AccessError(404, message("Errors.communityNotFound"));

async function hostContext(tx: Transaction, userId: string, slug: string): Promise<ForumContext> {
  const ctx = await forumContextTx(tx, userId, slug);
  // Non-hosts get the same neutral answer as non-members.
  if (!ctx || !ctx.canModerate) throw notFound();
  return ctx;
}

const reportInput = z.object({ targetType: z.enum(reportTargets), targetId: z.string().min(1).max(200), reason: z.enum(reportReasons),
  note: z.string().trim().max(500).optional().transform((v) => v || null) }).strict();
/** Any reader may report a post, reply or member once. Reporters are never shown to the person they reported. */
export async function reportContent(db: Database, userId: string, slug: string, raw: unknown) {
  const input = reportInput.parse(raw);
  if (input.targetType !== "member") z.uuid().parse(input.targetId);
  return forumDefiner(db, userId, sql`select public.community_report(${communitySlug.parse(slug)}, ${input.targetType}, ${input.targetId}, ${input.reason}, ${input.note}) as v`);
}

export type QueueItem = { reportId: string; targetType: ReportTarget; targetId: string; reports: number; firstReportedAt: Date; reasons: ReportReason[]; notes: string[];
  title: string; excerpt: string; authorId: string | null; authorName: string | null; postId: string | null; removed: boolean };

type Target = { title: string; excerpt: string; authorId: string | null; authorName: string | null; postId: string | null; removed: boolean };
async function describeTargets(tx: Transaction, communityId: string, items: { targetType: string; targetId: string }[]) {
  const ids = (type: string) => items.filter((i) => i.targetType === type).map((i) => i.targetId);
  const out = new Map<string, Target>();
  const postIds = ids("post"), commentIds = ids("comment"), memberIds = ids("member");
  if (postIds.length) for (const p of await tx.select({ id: communityPosts.id, title: communityPosts.title, text: communityPosts.bodyText, authorId: communityPosts.authorId,
    authorName: users.name, removedAt: communityPosts.removedAt }).from(communityPosts).leftJoin(users, eq(users.id, communityPosts.authorId))
    .where(and(eq(communityPosts.communityId, communityId), inArray(communityPosts.id, postIds))))
    out.set(`post:${p.id}`, { title: p.title, excerpt: p.text.replace(/\s+/g, " ").slice(0, 280), authorId: p.authorId, authorName: p.authorName, postId: p.id, removed: Boolean(p.removedAt) });
  if (commentIds.length) for (const c of await tx.select({ id: communityComments.id, body: communityComments.body, postId: communityComments.postId, authorId: communityComments.authorId,
    authorName: users.name, removedAt: communityComments.removedAt }).from(communityComments).leftJoin(users, eq(users.id, communityComments.authorId))
    .where(and(eq(communityComments.communityId, communityId), inArray(communityComments.id, commentIds))))
    out.set(`comment:${c.id}`, { title: "", excerpt: c.body.replace(/\s+/g, " ").slice(0, 280), authorId: c.authorId, authorName: c.authorName, postId: c.postId, removed: Boolean(c.removedAt) });
  if (memberIds.length) for (const u of await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, memberIds)))
    out.set(`member:${u.id}`, { title: u.name, excerpt: "", authorId: u.id, authorName: u.name, postId: null, removed: false });
  return out;
}

/** Open reports grouped by target. Reporter ids are never selected. */
export function moderationQueue(db: Database, userId: string, slug: string) {
  return withUser(db, userId, async (tx) => {
    const ctx = await hostContext(tx, userId, slug);
    const groups = await tx.select({ targetType: communityReports.targetType, targetId: communityReports.targetId,
      reportId: sql<string>`(array_agg(${communityReports.id} order by ${communityReports.createdAt}))[1]`,
      reports: sql<number>`count(*)::int`, firstReportedAt: sql<Date>`min(${communityReports.createdAt})`,
      reasons: sql<ReportReason[]>`array_agg(distinct ${communityReports.reason})`,
      notes: sql<string[]>`coalesce(array_agg(${communityReports.note}) filter (where ${communityReports.note} is not null), '{}')` })
      .from(communityReports).where(and(eq(communityReports.communityId, ctx.id), eq(communityReports.status, "open")))
      .groupBy(communityReports.targetType, communityReports.targetId).orderBy(desc(sql`count(*)`), sql`min(${communityReports.createdAt})`).limit(200);
    const targets = await describeTargets(tx, ctx.id, groups);
    // A host never sees (or decides) reports about themselves or their own content (review on #63).
    const items: QueueItem[] = groups.map((g) => ({ ...g, firstReportedAt: new Date(g.firstReportedAt), targetType: g.targetType as ReportTarget,
      ...(targets.get(`${g.targetType}:${g.targetId}`) ?? { title: "", excerpt: "", authorId: null, authorName: null, postId: null, removed: true }) }))
      .filter((item) => item.authorId !== userId);
    return { context: ctx, items };
  });
}

export type HeldItem = { targetType: "post" | "comment"; id: string; postId: string; title: string; excerpt: string; authorId: string | null; authorName: string | null;
  reason: "first_post" | "banned_word"; heldAt: Date };
export function heldItems(db: Database, userId: string, slug: string) {
  return withUser(db, userId, async (tx) => {
    const ctx = await hostContext(tx, userId, slug);
    const posts = await tx.select({ id: communityPosts.id, title: communityPosts.title, text: communityPosts.bodyText, authorId: communityPosts.authorId, authorName: users.name,
      reason: communityPosts.heldReason, heldAt: communityPosts.heldAt }).from(communityPosts).leftJoin(users, eq(users.id, communityPosts.authorId))
      .where(and(eq(communityPosts.communityId, ctx.id), isNotNull(communityPosts.heldAt), isNull(communityPosts.removedAt))).limit(200);
    const comments = await tx.select({ id: communityComments.id, postId: communityComments.postId, body: communityComments.body, authorId: communityComments.authorId,
      authorName: users.name, reason: communityComments.heldReason, heldAt: communityComments.heldAt }).from(communityComments).leftJoin(users, eq(users.id, communityComments.authorId))
      .where(and(eq(communityComments.communityId, ctx.id), isNotNull(communityComments.heldAt), isNull(communityComments.removedAt))).limit(200);
    const items: HeldItem[] = [
      ...posts.map((p) => ({ targetType: "post" as const, id: p.id, postId: p.id, title: p.title, excerpt: p.text.replace(/\s+/g, " ").slice(0, 280), authorId: p.authorId,
        authorName: p.authorName, reason: p.reason!, heldAt: p.heldAt! })),
      ...comments.map((c) => ({ targetType: "comment" as const, id: c.id, postId: c.postId, title: "", excerpt: c.body.replace(/\s+/g, " ").slice(0, 280), authorId: c.authorId,
        authorName: c.authorName, reason: c.reason!, heldAt: c.heldAt! })),
    ].filter((item) => item.authorId !== userId).sort((x, y) => x.heldAt.getTime() - y.heldAt.getTime());
    return { context: ctx, items };
  });
}

/** Open reports (distinct targets) plus held items: the badge on the Moderation rail item. Null for non-hosts. */
export function moderationCount(db: Database, userId: string, slug: string) {
  return withUser(db, userId, async (tx) => {
    const ctx = await forumContextTx(tx, userId, slug);
    if (!ctx?.canModerate) return null;
    // Same exclusions as the queue and held list: nothing about the host themselves.
    const [{ n }] = (await tx.execute<{ n: number }>(sql`select
      (select count(distinct (r.target_type, r.target_id))::int from community_reports r where r.community_id = ${ctx.id} and r.status = 'open'
        and not (r.target_type = 'member' and r.target_id = ${userId})
        and not exists (select 1 from community_posts p where r.target_type = 'post' and p.id::text = r.target_id and p.author_id = ${userId})
        and not exists (select 1 from community_comments c where r.target_type = 'comment' and c.id::text = r.target_id and c.author_id = ${userId}))
      + (select count(*)::int from community_posts where community_id = ${ctx.id} and held_at is not null and removed_at is null and author_id is distinct from ${userId})
      + (select count(*)::int from community_comments where community_id = ${ctx.id} and held_at is not null and removed_at is null and author_id is distinct from ${userId}) as n`)).rows;
    return n;
  });
}

const decideInput = z.object({ decision: z.enum(["keep", "remove"]) }).strict();
export async function decideReport(db: Database, userId: string, slug: string, reportId: string, raw: unknown) {
  const { decision } = decideInput.parse(raw);
  return forumDefiner(db, userId, sql`select public.community_report_decide(${communitySlug.parse(slug)}, ${z.uuid().parse(reportId)}::uuid, ${decision}) as v`);
}

const heldInput = z.object({ targetType: z.enum(["post", "comment"]), id: z.uuid(), decision: z.enum(["approve", "reject"]) }).strict();
export async function decideHeld(db: Database, userId: string, slug: string, raw: unknown) {
  const input = heldInput.parse(raw);
  return forumDefiner(db, userId, sql`select public.community_held_decide(${communitySlug.parse(slug)}, ${input.targetType}, ${input.id}::uuid, ${input.decision}) as v`);
}

export type ModerationMember = { userId: string; name: string; role: string; status: "active" | "banned"; joinedAt: string | null; mutedUntil: string | null };
export function moderationMembers(db: Database, userId: string, slug: string) {
  return withUser(db, userId, async (tx) => {
    const ctx = await hostContext(tx, userId, slug);
    const members = (await tx.execute<{ v: ModerationMember }>(sql`select public.community_moderation_members(${ctx.slug}) as v`)).rows.map((r) => r.v);
    return { context: ctx, members };
  });
}

const memberInput = z.object({ userId: z.string().min(1).max(200), action: z.enum(memberActions),
  days: z.union(muteDays.map((d) => z.literal(d)) as unknown as [z.ZodLiteral<1>, z.ZodLiteral<7>, z.ZodLiteral<30>]).optional() }).strict();
export async function moderateMember(db: Database, userId: string, slug: string, raw: unknown) {
  const input = memberInput.parse(raw);
  if (input.action === "mute" && !input.days) throw new AccessError(400, message("Errors.forumInputInvalid"));
  return forumDefiner(db, userId, sql`select public.community_member_moderate(${communitySlug.parse(slug)}, ${input.userId}, ${input.action}, ${input.days ?? null}::int) as v`);
}

export type HistoryEntry = { id: string; action: string; targetType: string; targetId: string; actorName: string | null; subjectName: string | null; detail: Record<string, unknown>; createdAt: Date };
export function moderationHistory(db: Database, userId: string, slug: string) {
  return withUser(db, userId, async (tx) => {
    const ctx = await hostContext(tx, userId, slug);
    const actor = alias(users, "actor"), subject = alias(users, "subject");
    const entries: HistoryEntry[] = await tx.select({ id: communityModerationActions.id, action: communityModerationActions.action, targetType: communityModerationActions.targetType,
      targetId: communityModerationActions.targetId, actorName: actor.name, subjectName: subject.name,
      detail: sql<Record<string, unknown>>`${communityModerationActions.detail}`, createdAt: communityModerationActions.createdAt })
      .from(communityModerationActions).leftJoin(actor, eq(actor.id, communityModerationActions.actorId)).leftJoin(subject, eq(subject.id, communityModerationActions.subjectUserId))
      .where(eq(communityModerationActions.communityId, ctx.id)).orderBy(desc(communityModerationActions.createdAt)).limit(200);
    return { context: ctx, entries };
  });
}
