import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { message } from "../i18n/messages";
import { chatBody, chatRevision, messagePollInput } from "../lib/chat";
import { reportReasons } from "../lib/moderation";
import { communitySlug } from "./communities";
import { chatResponse, communityChatEnabled, communityChatRoute, type ChatResult } from "./community-chat";
import { AccessError } from "./permissions";
import { withUser } from "./tenancy";

const userId = z.string().min(1).max(200);
const start = z.object({ targetUserId: userId, body: chatBody, client_id: z.uuid() }).strict();
const send = start.omit({ targetUserId: true });
const edit = z.object({ body: chatBody }).strict();
const report = z.object({ messageId: z.uuid(), reason: z.enum(reportReasons), note: z.string().trim().max(500).optional() }).strict();

function enabled() {
  if (!communityChatEnabled()) throw new AccessError(404, message("Errors.communityNotFound"));
}

/** Outcomes intentionally contain no reason for a recipient's refusal. */
async function executeDm(db: Database, viewer: string, statement: SQL): Promise<ChatResult> {
  enabled();
  return withUser(db, viewer, async tx => (await tx.execute<{ result: ChatResult }>(statement)).rows[0].result);
}

export function dmList(db: Database, user: string, slug: string) {
  return executeDm(db, user, sql`select public.community_dm_list(${communitySlug.parse(slug)}) result`);
}

export function dmStart(db: Database, user: string, slug: string, body: unknown) {
  const { targetUserId, body: text, client_id } = start.parse(body);
  return executeDm(db, user, sql`select public.community_dm_start(${communitySlug.parse(slug)},${targetUserId},${text},${client_id}::uuid) result`);
}

export function dmSend(db: Database, user: string, slug: string, id: string, body: unknown) {
  const { body: text, client_id } = send.parse(body);
  return executeDm(db, user, sql`select public.community_dm_send(${communitySlug.parse(slug)},${z.uuid().parse(id)}::uuid,${text},${client_id}::uuid) result`);
}

export function dmMessages(db: Database, user: string, slug: string, id: string, query: URLSearchParams, etag: string | null) {
  const { since, before, limit } = messagePollInput.parse(Object.fromEntries(query));
  return executeDm(db, user, sql`select public.community_dm_messages(${communitySlug.parse(slug)},${z.uuid().parse(id)}::uuid,
    ${since ?? null}::bigint,${before ?? null}::bigint,${limit},${etag}) result`);
}

export function dmChangeMessage(db: Database, user: string, slug: string, id: string, action: "edit" | "delete" | "restore", body?: unknown) {
  const address = communitySlug.parse(slug), mid = z.uuid().parse(id);
  if (action === "edit") return executeDm(db, user, sql`select public.community_dm_edit(${address},${mid}::uuid,${edit.parse(body).body}) result`);
  if (action === "delete") return executeDm(db, user, sql`select public.community_dm_delete_message(${address},${mid}::uuid) result`);
  return executeDm(db, user, sql`select public.community_dm_restore_message(${address},${mid}::uuid) result`);
}

export function dmPrefs(db: Database, user: string, slug: string, id: string, action: "read" | "mute" | "hide", raw: unknown) {
  const address = communitySlug.parse(slug), cid = z.uuid().parse(id);
  if (action === "read") {
    const { upTo } = z.object({ upTo: chatRevision }).strict().parse(raw);
    return executeDm(db, user, sql`select public.community_dm_read(${address},${cid}::uuid,${upTo}::bigint) result`);
  }
  if (action === "mute") {
    const { muted } = z.object({ muted: z.boolean() }).strict().parse(raw);
    return executeDm(db, user, sql`select public.community_dm_mute(${address},${cid}::uuid,${muted}) result`);
  }
  const { hidden } = z.object({ hidden: z.boolean() }).strict().parse(raw);
  return executeDm(db, user, sql`select public.community_dm_hide(${address},${cid}::uuid,${hidden}) result`);
}

export function dmAccept(db: Database, user: string, slug: string, raw: unknown) {
  const { acceptMembers } = z.object({ acceptMembers: z.boolean() }).strict().parse(raw);
  return executeDm(db, user, sql`select public.community_dm_accept_save(${communitySlug.parse(slug)},${acceptMembers}) result`);
}

export function dmPeople(db: Database, user: string, slug: string, query: string | null) {
  return executeDm(db, user, sql`select public.community_dm_people(${communitySlug.parse(slug)},${z.string().trim().max(80).parse(query ?? "")}) result`);
}

export function dmBlock(db: Database, user: string, slug: string, raw: unknown, undo: boolean) {
  const { targetUserId, hide } = z.object({ targetUserId: userId, hide: z.boolean().default(false) }).strict().parse(raw);
  const address = communitySlug.parse(slug);
  return executeDm(db, user, undo
    ? sql`select public.community_dm_unblock(${address},${targetUserId}) result`
    : sql`select public.community_dm_block(${address},${targetUserId},${hide}) result`);
}

export async function dmBlockConversation(db: Database, user: string, slug: string, id: string, raw: unknown, undo: boolean) {
  enabled();
  const { hide } = z.object({ hide: z.boolean().default(false) }).strict().parse(raw ?? {});
  const address = communitySlug.parse(slug), cid = z.uuid().parse(id);
  return withUser(db, user, async tx => {
    const { rows: [other] } = await tx.execute<{ user_id: string }>(sql`
      select p.user_id from public.community_dm_participants p join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
      where p.conversation_id = ${cid}::uuid and p.user_id <> ${user} and c.slug = ${address}
    `);
    if (!other) return { outcome: "not_found" };
    const { rows: [{ result }] } = await tx.execute<{ result: ChatResult }>(undo
      ? sql`select public.community_dm_unblock(${address},${other.user_id}) result`
      : sql`select public.community_dm_block(${address},${other.user_id},${hide}) result`);
    return result;
  });
}

export function dmReport(db: Database, user: string, slug: string, raw: unknown, conversationId?: string) {
  const { messageId, reason, note } = report.parse(raw);
  const address = communitySlug.parse(slug), cid = conversationId ? z.uuid().parse(conversationId) : null;
  return executeDm(db, user, sql`select public.community_dm_report(${address},${messageId}::uuid,${reason},${note || null},${cid}::uuid) result`);
}

export function dmReports(db: Database, user: string, slug: string) {
  return executeDm(db, user, sql`select public.community_dm_reports(${communitySlug.parse(slug)}) result`);
}

export function dmEvidence(db: Database, user: string, slug: string, reportId: string) {
  return executeDm(db, user, sql`select public.community_dm_evidence_view(${z.uuid().parse(reportId)}::uuid,${communitySlug.parse(slug)}) result`);
}

export function dmDecide(db: Database, user: string, slug: string, reportId: string, raw: unknown) {
  const { decision } = z.object({ decision: z.enum(["keep", "action"]) }).strict().parse(raw);
  return executeDm(db, user, sql`select public.community_dm_report_decide(${communitySlug.parse(slug)},${z.uuid().parse(reportId)}::uuid,${decision}) result`);
}

export function dmRoute<P>(run: (args: Parameters<Parameters<typeof communityChatRoute<P>>[0]>[0]) => Promise<ChatResult>, write: boolean) {
  return communityChatRoute<P>(async args => {
    const result = await run(args);
    return result.outcome === "not_found" ? new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } })
      : result.outcome === "duplicate" ? Response.json(result, { status: 409, headers: { "Cache-Control": "private, no-store" } })
      : chatResponse(result);
  }, { write });
}
