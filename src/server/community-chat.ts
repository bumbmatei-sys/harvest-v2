import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { channelInput, channelMutes, chatReactions, chatRevision, messageEditInput, messageInput, messagePollInput } from "../lib/chat";
import { message } from "../i18n/messages";
import { communitySlug } from "./communities";
import { communitiesEnabled } from "./communities-mode";
import { communityRoute } from "./community-route";
import { AccessError } from "./permissions";
import { withUser } from "./tenancy";

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
type State = ChatResult & { channels: { id: string; latestRev: string; unread: number; mentions: number; mute: string }[]; chatStateRev: string };
/** Reader identity + only readable channel pairs + own revision. No global counter enters the detector. */
export function chatRailEtag(user: string, state: Pick<State, "channels" | "chatStateRev">) {
  const pairs = state.channels.map(c => [c.id, c.latestRev]).sort((a, b) => a[0].localeCompare(b[0]));
  return `W/"${createHash("sha256").update(JSON.stringify([user, pairs, state.chatStateRev])).digest("hex")}"`;
}
export function chatState(db: Database, user: string, slug: string, ifNoneMatch?: string | null) {
  enabled(); const parsed = communitySlug.parse(slug);
  return withUser(db, user, async tx => {
    const query = (detector: boolean) => execute<State>(tx, sql`select public.community_chat_state_read(${parsed},${detector}) result`);
    let state = await query(Boolean(ifNoneMatch));
    if (ifNoneMatch && chatRailEtag(user, state) === ifNoneMatch) return { notModified: true, etag: ifNoneMatch };
    if (ifNoneMatch) state = await query(false);
    return { ...state, etag: chatRailEtag(user, state) };
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
  return call(db,user,sql`select public.community_chat_moderation_read(${communitySlug.parse(slug)},${source}) result`);
}
