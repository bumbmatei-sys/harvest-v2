import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { files, socialInboxReplies, socialInboxSavedReplies } from "../../db/schema";
import { accountView, auditInbox, inboxItem, inboxModes, inboxText, providerAccess, referenceInput, replyCapability, withInbox } from "./inbox-access";
import { renderSavedReply } from "./inbox-metadata";
import { fingerprintFields, transientInboxReplies, type ReplyHandoff } from "./inbox-reply-handoff";
import { inboxFingerprint, matchesFingerprint } from "./inbox-tokens";
import { publishConflict, publishInvalid, recordId, unavailable, versionInput } from "./publish-access";
import { defaultSocialDeps } from "./registry";

export const SOCIAL_HUMAN_REPLY_ENABLED = false;

const replyTarget = z.object({
  mode: z.enum(["message", "comment", "private", "mention"]),
  targetRef: referenceInput.nullable().default(null),
});
const submitInput = replyTarget.extend({
  id: z.uuid(), fileId: z.uuid().nullable().default(null),
  text: inboxText(10_000).optional(),
  saved: z.object({ id: z.uuid(), version: versionInput, variables: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
    inboxText(500)).refine(value => Object.keys(value).length <= 20) }).strict().optional(),
}).strict().refine(value => (!value.saved || !value.text) && (!!value.saved || !!value.text || !!value.fileId));

export type InboxReplyDeps = { enabled: boolean; handoff: ReplyHandoff; social: ReturnType<typeof defaultSocialDeps> };
export const defaultInboxReplyDeps = (): InboxReplyDeps => ({
  enabled: SOCIAL_HUMAN_REPLY_ENABLED, handoff: transientInboxReplies, social: defaultSocialDeps(),
});

const receipt = (row: typeof socialInboxReplies.$inferSelect) =>
  ({ id: row.id, itemId: row.itemId, mode: row.mode, state: row.state, version: row.version,
    retryAt: row.state === "queued" ? row.nextAt : null, firstAttemptAt: row.firstAttemptAt });

export function getInboxReply(db: Database, user: string, workspace: string, itemId: string, id: string, deps = defaultSocialDeps()) {
  return withInbox(db, user, workspace, deps, async (tx, tenant) => {
    await inboxItem(tx, tenant, itemId);
    const [row] = await tx.select().from(socialInboxReplies).where(and(eq(socialInboxReplies.tenantId, tenant),
      eq(socialInboxReplies.itemId, itemId), eq(socialInboxReplies.id, recordId(id))));
    if (!row || row.actorId !== user) throw unavailable();
    return { reply: receipt(row) };
  }, "social:reply");
}

export async function checkInboxReply(db: Database, user: string, workspace: string, itemId: string, body: unknown, deps = defaultSocialDeps()) {
  const input = replyTarget.strict().parse(body);
  const { account, item } = await withInbox(db, user, workspace, deps, (tx, tenant) => inboxItem(tx, tenant, itemId), "social:reply");
  const view = accountView(account);
  if (view.state !== "available" || !inboxModes[item.kind].includes(input.mode) || view.capabilities[replyCapability[input.mode]] === "unavailable") {
    return { eligibility: { allowed: false, reason: view.state === "available" ? "unavailable" : view.state } };
  }
  try {
    const { provider, credential } = providerAccess(account, deps);
    const eligibility = await provider.inboxReplyEligibility(credential, { ...input, accountRef: account.externalAccountRef, platform: account.platform,
      kind: item.kind, ref: item.providerRef, signal: AbortSignal.timeout(5_000) });
    const current = await withInbox(db, user, workspace, deps, (tx, tenant) => inboxItem(tx, tenant, itemId), "social:reply");
    if (current.account.version !== account.version || accountView(current.account).state !== "available") throw unavailable();
    if (eligibility.allowed && eligibility.expiresAt && eligibility.expiresAt <= deps.now()) return { eligibility: { allowed: false, reason: "expired_window" } };
    return { eligibility };
  } catch (error) {
    if (error instanceof Error && "status" in error) throw error;
    return { eligibility: { allowed: false, reason: "unavailable" } };
  }
}

export async function submitInboxReply(db: Database, user: string, workspace: string, itemId: string, body: unknown, deps = defaultInboxReplyDeps()) {
  if (!deps.enabled) throw unavailable();
  const input = submitInput.parse(body);
  const { social } = deps;
  const queued = await withInbox(db, user, workspace, social, async (tx, tenantId) => {
    const loaded = await inboxItem(tx, tenantId, itemId, true);
    const { item, account } = loaded;
    const view = accountView(account);
    const [existing] = await tx.select().from(socialInboxReplies).where(and(eq(socialInboxReplies.tenantId, tenantId), eq(socialInboxReplies.id, input.id)));
    if (existing && (existing.actorId !== user || existing.itemId !== itemId)) throw unavailable();
    let text = input.text ?? "";
    if (input.saved) {
      const [saved] = await tx.select().from(socialInboxSavedReplies).where(and(eq(socialInboxSavedReplies.tenantId, tenantId),
        eq(socialInboxSavedReplies.id, input.saved.id), eq(socialInboxSavedReplies.archived, false))).for("share");
      if (!saved) throw unavailable();
      if (saved.version !== input.saved.version) throw publishConflict();
      text = renderSavedReply(saved.template, input.saved.variables);
    }
    const transient = { tenantId, id: input.id, itemId, mode: input.mode, targetRef: input.targetRef, fileId: input.fileId, text };
    if (existing) {
      if (!matchesFingerprint(transient, existing.fingerprint)) throw publishConflict("INBOX_REPLY_IDEMPOTENCY_CONFLICT");
      return { row: existing, transient };
    }
    const caps = view.capabilities;
    if (input.mode === "message" && account.platform === "tiktok" && (text.length > 6_000 || (text && input.fileId))) {
      throw publishInvalid("INBOX_TIKTOK_MESSAGE_FORMAT");
    }
    if (view.state !== "available") throw publishConflict("INBOX_ACCOUNT_UNAVAILABLE");
    if (!inboxModes[item.kind].includes(input.mode) || caps[replyCapability[input.mode]] === "unavailable"
      || ((input.mode === "private" || input.mode === "comment") && !input.targetRef)
      || (input.mode === "message" && input.targetRef && caps.quoteReply === "unavailable")) throw publishInvalid("INBOX_REPLY_UNAVAILABLE");
    if (input.fileId) {
      if ((input.mode !== "message" || caps.messageMedia === "unavailable") && (input.mode !== "comment" || caps.commentMedia === "unavailable")) {
        throw publishInvalid("INBOX_MEDIA_UNAVAILABLE");
      }
      const [file] = await tx.select({ id: files.id }).from(files).where(and(eq(files.tenantId, tenantId), eq(files.id, input.fileId),
        eq(files.status, "ready"), isNull(files.socialRetiredAt), eq(files.visibility, "private"), eq(files.socialUpload, true)));
      if (!file) throw unavailable();
    }
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into public.social_inbox_replies (tenant_id,id,item_id,actor_id,connection_version,mode,fingerprint,target_ref,file_id)
      values (${tenantId},${input.id},${itemId},${user},${account.version},${input.mode},
        ${inboxFingerprint(fingerprintFields(transient))},${input.targetRef},${input.fileId})
      on conflict do nothing returning id`);
    const [row] = await tx.select().from(socialInboxReplies).where(and(eq(socialInboxReplies.tenantId, tenantId), eq(socialInboxReplies.id, input.id)));
    if (!row && input.mode === "private") throw publishConflict("INBOX_PRIVATE_REPLY_ALREADY_QUEUED");
    if (!row || row.actorId !== user || row.itemId !== itemId) throw unavailable();
    if (!matchesFingerprint(transient, row.fingerprint)) throw publishConflict("INBOX_REPLY_IDEMPOTENCY_CONFLICT");
    if (inserted.rows.length) await auditInbox(tx, tenantId, user, "reply_queued", row.id, row.version);
    return { row, transient };
  }, "social:reply");
  // Publish only after the authorized metadata receipt commits. A retry can re-offer an identical body.
  const recoverable = queued.row.state === "queued" || queued.row.state === "leased";
  const bodyAvailable = recoverable && deps.handoff.offer(queued.transient);
  return { reply: receipt(queued.row), bodyAvailable };
}
