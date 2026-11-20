import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { message } from "../i18n/messages";
import { forumContextTx, type DirectoryMember, type ForumContext } from "./community-forum";
import { readMemberProfileTx } from "./community-profile-details";
import { AccessError } from "./permissions";
import { withUser } from "./tenancy";

// The profile read used by the API resolves the person. Activity remains limited to the viewer's forum access.
export const activityPageSize = 20;
export type ProfileActivity = { kind: "post" | "reply"; id: string; postId: string; postTitle: string; excerpt: string; createdAt: string };
export type MemberProfile = { context: ForumContext; member: DirectoryMember; self: boolean; posts: number; replies: number;
  activity: ProfileActivity[]; page: number; hasMore: boolean };

const notFound = () => new AccessError(404, message("Errors.communityNotFound"));
const pageInput = z.coerce.number().int().min(1).max(1000).catch(1);

/**
 * One answer for every target the viewer may not see: unknown, not a member, no longer active, or the viewer cannot read the community.
 * Held and removed content never appears; held content is visible only to its author on their own profile.
 */
export async function memberProfile(db: Database, viewerId: string, slug: string, target: string, rawPage: unknown = 1): Promise<MemberProfile> {
  const page = pageInput.parse(rawPage);
  return withUser(db, viewerId, async (tx) => {
    const context = await forumContextTx(tx, viewerId, slug);
    if (!context) throw notFound();
    const { member } = await readMemberProfileTx(tx, context.slug, target.trim());
    const self = member.userId === viewerId;
    const postVisible = sql`p.community_id = ${context.id}::uuid and p.removed_at is null and (p.held_at is null or ${self})`;
    const commentVisible = sql`c.community_id = ${context.id}::uuid and c.removed_at is null and (c.held_at is null or ${self})`;
    const [{ posts, replies }] = (await tx.execute<{ posts: number; replies: number }>(sql`select
      (select count(*)::int from community_posts p where ${postVisible} and p.author_id = ${member.userId}) as posts,
      (select count(*)::int from community_comments c join community_posts p on p.id = c.post_id
        where ${commentVisible} and c.author_id = ${member.userId} and ${postVisible}) as replies`)).rows;
    const rows = (await tx.execute<{ kind: "post" | "reply"; id: string; post_id: string; title: string; excerpt: string; created_at: Date | string }>(sql`
      select kind, id, post_id, title, excerpt, created_at from (
        select 'post' as kind, p.id, p.id as post_id, p.title, left(p.body_text, 200) as excerpt, p.created_at
          from community_posts p where ${postVisible} and p.author_id = ${member.userId}
        union all
        select 'reply' as kind, c.id, c.post_id, p.title, left(c.body, 200) as excerpt, c.created_at
          from community_comments c join community_posts p on p.id = c.post_id
          where ${commentVisible} and c.author_id = ${member.userId} and ${postVisible}
      ) a order by created_at desc, id limit ${activityPageSize + 1} offset ${(page - 1) * activityPageSize}`)).rows;
    return { context, member, self, posts, replies, page, hasMore: rows.length > activityPageSize,
      activity: rows.slice(0, activityPageSize).map((r) => ({ kind: r.kind, id: r.id, postId: r.post_id, postTitle: r.title,
        excerpt: r.excerpt.replace(/\s+/g, " ").trim(), createdAt: new Date(r.created_at).toISOString() })) };
  });
}
