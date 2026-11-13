import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import type { NotificationView } from "../lib/notifications";
import { message } from "../i18n/messages";
import { communitySlug } from "./communities";
import { forumContextTx, forumDefiner, type ForumContext } from "./community-forum";
import { AccessError } from "./permissions";
import { withUser } from "./tenancy";

// C15a: in-app notifications. Reads of the member's own rows run in withUser (recipient policy); every write is a
// definer in migration 0041, except the application decision notice, which the staff path inserts itself.
const notFound = () => new AccessError(404, message("Errors.communityNotFound"));

/** Notifications and unseen announcements for the bell. The definer re-checks that the caller can read the community. */
export async function listNotifications(db: Database, userId: string, slug: string) {
  const parsed = communitySlug.parse(slug);
  const result = await withUser(db, userId, async (tx) => (await tx.execute<{ v: { outcome: string; unread: number; items: NotificationView[] } }>(
    sql`select public.community_notifications_list(${parsed}, 30) as v`)).rows[0].v);
  if (result.outcome !== "ok") throw notFound();
  return { unread: result.unread, items: result.items };
}

/** Unread rows plus unseen announcements (same rules as the list), for the badge on every member page. */
export async function unreadCountTx(tx: Transaction, ctx: ForumContext, userId: string) {
  const announce = ctx.prefs.announcements && !ctx.prefs.muted;
  const [row] = (await tx.execute<{ n: number }>(sql`select
    (select count(*)::int from community_notifications n where n.community_id = ${ctx.id} and n.recipient_id = ${userId} and n.read_at is null)
    + (case when ${announce} then (select count(*)::int from (select 1 from community_posts p join community_categories c on c.id = p.category_id
        where p.community_id = ${ctx.id} and p.removed_at is null and p.held_at is null and (c.hosts_only or p.pinned) and p.created_at > ${ctx.notificationsSince.toISOString()}::timestamptz
          and p.author_id is distinct from ${userId} limit 20) x) else 0 end) as n`)).rows;
  return row?.n ?? 0;
}

export function unreadCount(db: Database, userId: string, slug: string) {
  return withUser(db, userId, async (tx) => {
    const ctx = await forumContextTx(tx, userId, slug);
    if (!ctx) throw notFound();
    return unreadCountTx(tx, ctx, userId);
  });
}

const readInput = z.object({ ids: z.array(z.uuid()).max(100).nullable() }).strict();
/** ids null: everything; a list: those; an empty list: only the announcements count as seen (opening the bell). */
export async function markRead(db: Database, userId: string, slug: string, raw: unknown) {
  const { ids } = readInput.parse(raw);
  const list = ids === null ? null : `{${ids.join(",")}}`;
  return forumDefiner(db, userId, sql`select public.community_notifications_read(${communitySlug.parse(slug)}, ${list}::uuid[]) as v`);
}

const prefsInput = z.object({ replies: z.boolean(), likes: z.boolean(), announcements: z.boolean(), muted: z.boolean() }).strict();
export async function savePreferences(db: Database, userId: string, slug: string, raw: unknown) {
  const input = prefsInput.parse(raw);
  return forumDefiner(db, userId, sql`select public.community_notification_prefs_save(${communitySlug.parse(slug)}, ${input.replies}, ${input.likes}, ${input.announcements}, ${input.muted}) as v`);
}

const emailInput = z.object({ frequency: z.enum(["off", "important", "daily", "weekly"]) }).strict();
/** The caller's own email frequency for this community (off, important only, daily digest or weekly digest). */
export async function saveEmailFrequency(db: Database, userId: string, slug: string, raw: unknown) {
  const { frequency } = emailInput.parse(raw);
  return forumDefiner(db, userId, sql`select public.community_email_prefs_save(${communitySlug.parse(slug)}, ${frequency}) as v`);
}

export function dismissWelcome(db: Database, userId: string, slug: string) {
  return forumDefiner(db, userId, sql`select public.community_welcome_dismiss(${communitySlug.parse(slug)}) as v`);
}

/**
 * Application decisions run in the staff path, so the notice is inserted there under the tenant policy (kind 'application' only).
 * Never the decider, and never someone who has muted this community.
 */
export async function notifyApplicant(tx: Transaction, tenantId: string, communityId: string, recipientId: string, actorId: string, applicationId: string,
  status: "approved" | "declined" | "info_requested") {
  if (recipientId === actorId) return;
  await tx.execute(sql`insert into community_notifications (tenant_id, community_id, recipient_id, kind, target_type, target_id, actor_id, detail)
    select ${tenantId}::uuid, ${communityId}::uuid, ${recipientId}, 'application', 'application', ${applicationId}, ${actorId}, ${JSON.stringify({ status })}::jsonb
    where not exists (select 1 from community_memberships m where m.tenant_id = ${tenantId}::uuid and m.community_id = ${communityId}::uuid
      and m.user_id = ${recipientId} and m.notifications_muted)`);
}
