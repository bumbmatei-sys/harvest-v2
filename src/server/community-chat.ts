import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { communities, communityChannels, communityChannelMembers, communityMemberships, users, workspaceMembers } from "../db/schema";
import type { ChatChannel, ChatChannelSetting, ChatHeld, ChatMessage } from "../lib/chat-view";
import { channelInput, channelMutes, chatReactions, chatRevision, messageEditInput, messageInput, messagePollInput } from "../lib/chat";
import { message } from "../i18n/messages";
import { communityCan } from "../lib/community-permissions";
import { communitySlug } from "./communities";
import { forumContextTx, type DirectoryMember } from "./community-forum";
import { communitiesEnabled } from "./communities-mode";
import { communityRoute } from "./community-route";
import { AccessError } from "./permissions";
import { withTenant, withUser } from "./tenancy";

export function communityChatEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" && communitiesEnabled(env);
}
const notFound = () => new AccessError(404, message("Errors.communityNotFound"));
function enabled() { if (!communityChatEnabled()) throw notFound(); }
export function communityChatRoute<P>(run: Parameters<typeof communityRoute<P>>[0], options: { write: boolean }) {
  const route = communityRoute(run, options);
  return (request: Request, context: { params: Promise<P> }) => communityChatEnabled() ? route(request, context) : Promise.resolve(new Response(null, { status: 404 }));
}
export type ChatResult = { outcome: string; retryAfter?: number; [key: string]: unknown };
async function execute<T extends ChatResult = ChatResult>(tx: Transaction, query: SQL): Promise<T> {
  const result = (await tx.execute<{ result: T }>(query)).rows[0].result;
  if (result.outcome === "not_found") throw notFound();
  return result;
}
function call(db: Database, user: string, query: SQL) { enabled(); return withUser(db, user, tx => execute(tx, query)); }
export function saveChatChannel(db: Database, user: string, slug: string, channel: string | null, raw: unknown) {
  enabled(); const input = channelInput.parse(raw), id = channel === null ? null : z.uuid().parse(channel);
  return call(db, user, sql`select public.community_channel_save(${communitySlug.parse(slug)},${id}::uuid,${JSON.stringify(input)}::jsonb) result`);
}
export function deleteChatChannel(db: Database, user: string, slug: string, channel: string) {
  return call(db, user, sql`select public.community_channel_delete(${communitySlug.parse(slug)},${z.uuid().parse(channel)}::uuid) result`);
}
export function reorderChatChannels(db: Database, user: string, slug: string, raw: unknown) {
  enabled(); const input = z.object({ ids: z.array(z.uuid()).max(30) }).strict().parse(raw);
  return call(db, user, sql`select public.community_channel_reorder(${communitySlug.parse(slug)},${sql.param(input.ids)}::uuid[]) result`);
}
export function setChatChannelMembers(db: Database, user: string, slug: string, channel: string, raw: unknown) {
  enabled(); const input = z.object({ userIds: z.array(z.string().min(1).max(200)).max(1000) }).strict().parse(raw);
  return call(db, user, sql`select public.community_channel_members_set(${communitySlug.parse(slug)},${z.uuid().parse(channel)}::uuid,${sql.param(input.userIds)}::text[]) result`);
}
export function sendChatMessage(db: Database, user: string, slug: string, channel: string, raw: unknown) {
  enabled(); const input = messageInput.parse(raw);
  return call(db, user, sql`select public.community_message_send(${communitySlug.parse(slug)},${z.uuid().parse(channel)}::uuid,${input.parent_id}::uuid,${input.body},${sql.param(input.mention_ids)}::text[],${input.client_id}::uuid) result`);
}
export function editChatMessage(db: Database, user: string, slug: string, id: string, raw: unknown) {
  enabled(); const input = messageEditInput.parse(raw);
  return call(db, user, sql`select public.community_message_edit(${communitySlug.parse(slug)},${z.uuid().parse(id)}::uuid,${input.body},${sql.param(input.mention_ids)}::text[]) result`);
}
export function deleteChatMessage(db: Database, user: string, slug: string, id: string, restore = false) {
  return call(db, user, sql`select public.community_message_delete(${communitySlug.parse(slug)},${z.uuid().parse(id)}::uuid,${restore}) result`);
}
export function moderateChatMessage(db: Database, user: string, slug: string, id: string, raw: unknown) {
  enabled(); const input = z.object({ action: z.enum(["pin", "unpin", "remove", "restore", "approve", "reject"]) }).strict().parse(raw);
  return call(db, user, sql`select public.community_message_moderate(${communitySlug.parse(slug)},${z.uuid().parse(id)}::uuid,${input.action}) result`);
}
export function reactChatMessage(db: Database, user: string, slug: string, id: string, raw: unknown) {
  enabled(); const input = z.object({ emoji: z.enum(chatReactions) }).strict().parse(raw);
  return call(db, user, sql`select public.community_reaction_toggle(${communitySlug.parse(slug)},${z.uuid().parse(id)}::uuid,${input.emoji}) result`);
}
export function readChatChannel(db: Database, user: string, slug: string, channel: string, raw: unknown) {
  enabled(); const input = z.object({ upTo: chatRevision }).strict().parse(raw);
  return call(db, user, sql`select public.community_channel_read(${communitySlug.parse(slug)},${z.uuid().parse(channel)}::uuid,${input.upTo}::bigint) result`);
}
export function muteChatChannel(db: Database, user: string, slug: string, channel: string, raw: unknown) {
  enabled(); const input = z.object({ mute: z.enum(channelMutes) }).strict().parse(raw);
  return call(db, user, sql`select public.community_channel_prefs_save(${communitySlug.parse(slug)},${z.uuid().parse(channel)}::uuid,${input.mute}) result`);
}
type DmRail = { token: string; latestRev: string; unreadConversations: number };
type State = ChatResult & { channels: ChatChannel[]; chatStateRev: string };
/** Reader identity + only readable channel pairs + own revision. No global counter enters the detector. */
export function chatRailEtag(user: string, state: { channels: readonly Pick<ChatChannel, "id" | "latestRev">[]; chatStateRev: string; dmToken?: string }) {
  const pairs = state.channels.map(c => [c.id, c.latestRev]).sort((a, b) => a[0].localeCompare(b[0]));
  return `W/"${createHash("sha256").update(JSON.stringify([user, pairs, state.chatStateRev, state.dmToken ?? ""])).digest("hex")}"`;
}
export function chatState(db: Database, user: string, slug: string, ifNoneMatch?: string | null) {
  enabled(); const parsed = communitySlug.parse(slug);
  return withUser(db, user, async tx => {
    async function query(detector: boolean) {
      const state = await execute<State>(tx, sql`select public.community_chat_state_read(${parsed},${detector}) result`);
      const { rows: [{ dm }] } = await tx.execute<{ dm: DmRail }>(sql`select public.community_dm_rail(${parsed},${detector}) dm`);
      return { state, dm, etag: chatRailEtag(user, { ...state, dmToken: dm.token }) };
    }
    let result = await query(Boolean(ifNoneMatch));
    if (ifNoneMatch && result.etag === ifNoneMatch) return { notModified: true, etag: ifNoneMatch };
    if (ifNoneMatch) result = await query(false);
    const { state, etag } = result, dm = { latestRev: result.dm.latestRev, unreadConversations: result.dm.unreadConversations };
    if (!state.channels.length) return { ...state, dm, etag };
    const options = await tx.select({ id: communityChannels.id, archivedAt: communityChannels.archivedAt, minRole: communityChannels.minRole })
      .from(communityChannels).where(inArray(communityChannels.id, state.channels.map(channel => channel.id)));
    const details = new Map(options.map(option => [option.id, option]));
    const channels = state.channels.map(channel => {
      const option = details.get(channel.id);
      if (!option) return channel;
      const minRole = channelInput.shape.minRole.safeParse(option.minRole);
      return { ...channel, archived: Boolean(option.archivedAt), minRole: minRole.success ? minRole.data : undefined };
    });
    return { ...state, channels, dm, etag };
  });
}
export function chatMessages(db: Database, user: string, slug: string, channel: string, raw: unknown, ifNoneMatch?: string | null) {
  enabled(); const input = messagePollInput.parse(raw);
  return call(db, user, sql`select public.community_chat_messages(${communitySlug.parse(slug)},${z.uuid().parse(channel)}::uuid,${input.since ?? null}::bigint,${input.before ?? null}::bigint,${input.limit},${ifNoneMatch ?? null}) result`);
}
export function chatResponse(result: Record<string, unknown>) {
  const headers: Record<string, string> = { "Cache-Control": "private, no-store", "X-Poll-Interval": "4000" };
  if (typeof result.etag === "string") headers.ETag = result.etag;
  if (result.notModified) return new Response(null, { status: 304, headers });
  const status = result.outcome === "rate_limited" ? 429 : result.outcome === "forbidden" || result.outcome === "muted" ? 403 : result.outcome === "client_id_conflict" ? 409 : result.outcome && result.outcome !== "ok" ? 400 : 200;
  if (status === 429) headers["Retry-After"] = String(result.retryAfter ?? 10);
  return Response.json(result, { status, headers });
}

export function saveChatSettings(db: Database, user: string, slug: string, raw: unknown) {
  enabled(); const input = z.object({ chatEnabled: z.boolean(), dmPolicy: z.enum(["channels_only", "members"]) }).strict().parse(raw);
  return call(db, user, sql`select public.community_chat_settings_save(${communitySlug.parse(slug)},${input.chatEnabled},${input.dmPolicy}) result`);
}

export function chatModeration(db: Database, user: string, slug: string, source: "held" | "reports") {
  return call(db,user,sql`select public.community_chat_moderation_read(${communitySlug.parse(slug)},${source}) result`) as Promise<ChatResult & { items: ChatHeld[] }>;
}

/** The editor already has a verified ministry and community scope. Staff RLS supplies draft/archived rows. */
export function chatChannelSettings(db: Database, user: string, tenantId: string, communityId: string) {
  enabled();
  return withTenant(db, user, tenantId, "communities:manage", async (tx, tenant) => {
    const scope = and(eq(communityChannels.tenantId, tenant), eq(communityChannels.communityId, communityId));
    const [community] = await tx.select({ enabled: communities.chatEnabled, policy: communities.dmPolicy })
      .from(communities).where(and(eq(communities.tenantId, tenant), eq(communities.id, communityId)));
    if (!community) throw notFound();
    const [membership] = await tx.select({ status: communityMemberships.status }).from(communityMemberships)
      .where(and(eq(communityMemberships.tenantId, tenant), eq(communityMemberships.communityId, communityId), eq(communityMemberships.userId, user)));
    if (membership && membership.status !== "active") throw notFound();
    const channels = await tx.select({
      id: communityChannels.id, name: communityChannels.name, emoji: communityChannels.emoji,
      description: communityChannels.description, position: communityChannels.position, posting: communityChannels.posting,
      accessMode: communityChannels.accessMode, minRole: communityChannels.minRole,
      slowModeSeconds: communityChannels.slowModeSeconds, archived: sql<boolean>`${communityChannels.archivedAt} is not null`,
    }).from(communityChannels).where(scope).orderBy(asc(communityChannels.position), asc(communityChannels.id));
    const invites = await tx.select({ channelId: communityChannelMembers.channelId, userId: communityChannelMembers.userId })
      .from(communityChannelMembers).where(and(eq(communityChannelMembers.tenantId, tenant), eq(communityChannelMembers.communityId, communityId)));
    return { enabled: community.enabled, dmPolicy: community.policy === "members" ? "members" as const : "channels_only" as const,
      channels: channels.map(({ id, ...channel }) => ({ id, ...channelInput.parse(channel),
        userIds: invites.filter(invite => invite.channelId === id).map(invite => invite.userId) })) satisfies ChatChannelSetting[] };
  });
}

type StaffChatCommunity = { id: string; name: string; slug: string; role: string; muted: boolean };

/** Resolve the same ministry owner/admin path as C11a without granting generic forum access. */
async function withChatStaff<T>(db: Database, user: string, slug: string, run: (tx: Transaction, tenant: string, scope: StaffChatCommunity) => Promise<T>): Promise<T | undefined> {
  const ministries = await withUser(db, user, tx => tx.select({ tenant: workspaceMembers.tenantId }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, user), inArray(workspaceMembers.roleId, ["owner", "admin"]))));
  for (const { tenant } of ministries) {
    const result = await withTenant(db, user, tenant, "communities:manage", async (tx, id, role) => {
      const [scope] = await tx.select({ id: communities.id, name: communities.name, slug: communities.slug })
        .from(communities).where(and(eq(communities.tenantId, id), eq(communities.slug, slug), eq(communities.chatEnabled, true)));
      if (!scope) return;
      const [membership] = await tx.select({ status: communityMemberships.status, mutedUntil: communityMemberships.mutedUntil })
        .from(communityMemberships).where(and(eq(communityMemberships.tenantId, id), eq(communityMemberships.communityId, scope.id), eq(communityMemberships.userId, user)));
      if (membership && membership.status !== "active") throw notFound();
      return run(tx, id, { ...scope, role, muted: !!membership?.mutedUntil && membership.mutedUntil > new Date() });
    }).catch((error: unknown) => {
      if (!(error instanceof AccessError) || error.status !== 403) throw error;
      return undefined;
    });
    if (result !== undefined) return result;
  }
}

export function chatStaffPage(db: Database, user: string, slug: string) {
  enabled();
  return withChatStaff(db, user, communitySlug.parse(slug), async (tx, tenant, scope) => {
    const rows = await tx.select({ userId: users.id, name: users.name, role: communityMemberships.role, joinedAt: communityMemberships.joinedAt })
      .from(communityMemberships).innerJoin(users, eq(users.id, communityMemberships.userId))
      .where(and(eq(communityMemberships.tenantId, tenant), eq(communityMemberships.communityId, scope.id), eq(communityMemberships.status, "active")))
      .orderBy(asc(communityMemberships.joinedAt), asc(users.id)).limit(2000);
    const members: DirectoryMember[] = rows.map(row => ({ ...row, joinedAt: row.joinedAt?.toISOString() ?? null }));
    return { scope, members };
  });
}

async function readChatSettings(tx: Transaction, tenant: string, id: string) {
    const scope = and(eq(communityChannels.tenantId, tenant), eq(communityChannels.communityId, id));
    const rows = await tx.select({
      id: communityChannels.id, name: communityChannels.name, emoji: communityChannels.emoji,
      description: communityChannels.description, position: communityChannels.position, posting: communityChannels.posting,
      accessMode: communityChannels.accessMode, minRole: communityChannels.minRole,
      slowModeSeconds: communityChannels.slowModeSeconds, archived: sql<boolean>`${communityChannels.archivedAt} is not null`,
    }).from(communityChannels).where(scope).orderBy(asc(communityChannels.position), asc(communityChannels.id));
    const invites = await tx.select({ channelId: communityChannelMembers.channelId, userId: communityChannelMembers.userId })
      .from(communityChannelMembers).where(and(eq(communityChannelMembers.tenantId, tenant), eq(communityChannelMembers.communityId, id)));
    return rows.map(({ id, ...channel }) => ({ id, ...channelInput.parse(channel),
      userIds: invites.filter(invite => invite.channelId === id).map(invite => invite.userId) })) satisfies ChatChannelSetting[];
}

export async function chatManageSettings(db: Database, user: string, slug: string) {
  enabled();
  const parsed = communitySlug.parse(slug);
  const staff = await withChatStaff(db, user, parsed, (tx, tenant, scope) => readChatSettings(tx, tenant, scope.id));
  if (staff) return staff;
  return withUser(db, user, async tx => {
    const member = await forumContextTx(tx, user, parsed);
    if (!member || !member.chatEnabled) throw notFound();
    if (!communityCan(member.role, "chat:manage_channels")) throw new AccessError(403, message("Errors.forumActionNotAllowed"));
    return readChatSettings(tx, member.tenantId, member.id);
  });
}

/** Supplemental reads for pins and a thread root with its replies. Channel and message RLS both apply. */
export async function chatChannelSelection(db: Database, user: string, slug: string, channel: string, root: string | null, before: string | null) {
  enabled();
  const parsed = communitySlug.parse(slug), channelId = z.uuid().parse(channel);
  const parent = root === null ? null : z.uuid().parse(root);
  const cutoff = before === null ? null : chatRevision.parse(before);
  const read = async (tx: Transaction) => {
    const scope = await tx.execute<{ id: string }>(sql`
      select c.id from public.community_channels c
      join public.communities k on k.tenant_id=c.tenant_id and k.id=c.community_id
      where k.slug=${parsed} and c.id=${channelId}::uuid and c.archived_at is null
        and public.community_channel_can_read(c.tenant_id,c.community_id,c.id)
    `);
    if (!scope.rows.length) throw notFound();
    const result = await tx.execute<ChatMessage>(sql`
      select m.id, m.channel_id as "channelId", m.author_id as "authorId", u.name as "authorName",
        m.client_id as "clientId", m.parent_id as "parentId", m.seq::text, m.rev::text, m.body,
        m.mention_ids as "mentionIds",
        coalesce((select jsonb_agg(jsonb_build_object('id', person.id, 'name', person.name))
          from public.users person where person.id=any(m.mention_ids)), '[]') as mentions,
        m.created_at::text as "createdAt", m.edited_at::text as "editedAt", m.deleted_at::text as "deletedAt",
        m.deleted_kind as "deletedKind", m.held_at::text as "heldAt", m.pinned_at::text as "pinnedAt", m.reply_count as "replyCount",
        coalesce((select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'count', r.count, 'reactedByMe', r.mine))
          from (select emoji, count(*) count, bool_or(user_id=${user}) mine
            from public.community_message_reactions where message_id=m.id group by emoji) r), '[]') as reactions
      from public.community_messages m
      join public.community_channels c on c.id=m.channel_id
      join public.communities k on k.tenant_id=c.tenant_id and k.id=c.community_id
      left join public.users u on u.id=m.author_id
      where k.slug=${parsed} and c.id=${channelId}::uuid and c.archived_at is null
        and m.deleted_at is null
        and ${parent ? sql`(m.id=${parent}::uuid or (m.parent_id=${parent}::uuid and (${cutoff}::bigint is null or m.seq<${cutoff}::bigint)))` : sql`m.pinned_at is not null and m.held_at is null`}
      order by (m.id=${parent}::uuid) desc, m.seq desc limit ${parent ? 52 : 5}
    `);
    const rootRow = result.rows.find(row => row.id === parent);
    const replies = result.rows.filter(row => row.id !== parent);
    return { outcome: "ok", events: parent ? [...(rootRow ? [rootRow] : []), ...replies.slice(0, 50)] : replies,
      hasMore: parent !== null && replies.length > 50 };
  };
  const staff = await withChatStaff(db, user, parsed, read);
  return staff ?? withUser(db, user, read);
}
