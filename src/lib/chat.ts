import { z } from "zod";
import { communityRank } from "./moderation";

export const chatReactions = ["👍", "❤️", "🙏", "😊", "🎉", "👏", "💡", "🔥", "😮", "😢", "✅", "🙌"] as const;
export const channelAccessModes = ["all", "role", "invite", "tier", "tag"] as const;
export const channelMutes = ["none", "mentions_only", "all"] as const;
export const chatBody = z.string().min(1).max(2000).refine(v => v.trim().length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v));
export const channelInput = z.object({
  name: z.string().trim().min(1).max(60), emoji: z.string().max(16).nullable().default(null), description: z.string().max(200).nullable().default(null),
  position: z.number().int().min(0).default(0), posting: z.enum(["members", "hosts"]).default("members"),
  accessMode: z.enum(channelAccessModes).default("all"), minRole: z.enum(["member", "contributor", "moderator", "admin", "owner"]).default("member"),
  slowModeSeconds: z.number().int().min(0).max(3600).default(0), archived: z.boolean().default(false),
}).strict();
export const messageInput = z.object({ client_id: z.uuid(), parent_id: z.uuid().nullable().default(null), body: chatBody, mention_ids: z.array(z.string().min(1).max(200)).max(10).default([]) }).strict();
export const messageEditInput = messageInput.pick({ body: true, mention_ids: true });
/** Revision strings avoid lossy JSON numbers when a bigint grows beyond Number.MAX_SAFE_INTEGER. */
export const chatRevision = z.union([z.string().regex(/^\d{1,19}$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(String)])
  .refine(v => BigInt(v) <= 9223372036854775807n);
export const messagePollInput = z.object({ since: chatRevision.optional(), before: chatRevision.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict()
  .refine(v => !(v.since !== undefined && v.before !== undefined));
export function clampRead(upTo: bigint, maxSeq: bigint, previous = 0n) { return previous > upTo ? previous : upTo < 0n ? previous : upTo > maxSeq ? maxSeq : upTo; }
export function chatPurgeAfter(deletedAt: Date) { return new Date(+deletedAt + 30 * 86400000); }
export function channelEligible(input: { active: boolean; grant: boolean; role: string; accessMode: string; minRole: string; invited: boolean; archived: boolean }) {
  if (!input.active || (!input.grant && !["owner", "admin", "moderator", "contributor"].includes(input.role))) return false;
  if (communityRank(input.role) > 0) return true;
  const rank = (r: string) => r === "contributor" ? 1 : communityRank(r) ? communityRank(r) + 1 : 0;
  return !input.archived && (input.accessMode === "all" || (input.accessMode === "invite" && input.invited) || (input.accessMode === "role" && rank(input.role) >= rank(input.minRole)));
}
/** Resolve names only from validated mention_ids; forged tokens remain literal text. */
export function chatTokens(body: string, mentionIds: readonly string[]) {
  const allowed = new Set(mentionIds);
  return body.split(/(<@[^<>\s]+>)/g).filter(Boolean).map(text => {
    const id = /^<@([^<>\s]+)>$/.exec(text)?.[1];
    return id && allowed.has(id) ? { type: "mention" as const, id, text } : { type: "text" as const, text };
  });
}
