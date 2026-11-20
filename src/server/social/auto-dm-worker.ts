import { createHmac } from "node:crypto";
import { autoDmCapabilities, autoDmOpen, autoDmRuleInput, matchAutoDm, renderAutoDm, type AutoDmPlatform } from "../../lib/social/auto-dm";
import { credentialBinding, openCredential } from "./credential-envelope";
import type { InboxMedia, InboxReplyQuery } from "./inbox-contract";
import { SocialProviderError, type SocialProvider, type SocialSender } from "./port";
import type { SocialCredential } from "./types";

export const SOCIAL_AUTO_DM_SENDER_ENABLED = false;
type Pool = { query<R extends Record<string, unknown>>(query: string, values: unknown[]): Promise<{ rows: R[] }> };
type Job = {
  tenant_id: string; id: string; connection_id: string; lease: string; state: "leased" | "unknown";
  event_type: "message.received" | "comment.received"; subject_ref: string; activity_ref: string; occurred_at: string;
  platform: AutoDmPlatform; external_account_ref: string; credential_envelope: unknown;
  rule: unknown; provider_post_ref: string | null; step: "primary" | "public" | "followup";
  prefix: "rule" | "away" | null; policy_revision: number | null; timezone: string | null;
  hours: { day: number; start: string; end: string }[] | null; away_template: string | null;
  file_id: string | null; file_key: string | null; file_mime: string | null; file_size: number | null;
};
type ResultState = "queued" | "sent" | "unknown" | "skipped" | "handed_off";
type Options = { fake: SocialProvider & SocialSender & { id: "fake" }; recipientKey: Buffer; limit?: number;
  now?: () => Date; media?: (key: string, mime: string) => Promise<{ url: string; expiresAt: Date }> };

/** Uses the separate inbox sender port only after the worker role reserves dispatch. */
export async function runSocialAutoDm(pool: Pool, { fake, recipientKey, limit = 5, now = () => new Date(), media }: Options) {
  if (fake.id !== "fake" || recipientKey.length < 32) throw new Error("AUTO_DM_WORKER_UNAVAILABLE");
  const { rows: [{ jobs }] } = await pool.query<{ jobs: Job[] }>("select public.social_auto_dm_claim($1) as jobs", [limit]);
  const result: Record<string, number> = { leased: jobs.length };
  for (const job of jobs) {
    const params = [job.tenant_id, job.id, job.lease];
    const idempotencyKey = `harvest-auto-dm:${job.tenant_id}:${job.id}`;
    let recipient: string | null = null, conversation: string | null = null;
    const finish = async (state: ResultState, reason: string | null = null, ref: string | null = null, delay = 0) => {
      const { rows: [row] } = await pool.query<{ state: string }>(
        "select public.social_auto_dm_finish($1,$2,$3,$4,$5,$6,$7,$8,$9) as state", [...params, state, reason, ref, delay, recipient, conversation]);
      result[row.state] = (result[row.state] ?? 0) + 1;
    };
    try {
      const rule = autoDmRuleInput.safeParse(job.rule);
      if (!rule.success || autoDmCapabilities(job.platform)[rule.data.trigger] === "unavailable") {
        await finish(job.state === "unknown" ? "unknown" : "skipped", "ineligible"); continue;
      }
      const credential: SocialCredential = openCredential(job.credential_envelope, credentialBinding(job.tenant_id, job.connection_id));
      const signal = AbortSignal.timeout(10_000);
      const account = { accountRef: job.external_account_ref, platform: job.platform, signal };
      // A previous send may have been accepted even if the triggering evidence has disappeared.
      if (job.state === "unknown") {
        try {
          const found = await fake.reconcileInboxReply(credential, { ...account, idempotencyKey, ref: job.subject_ref,
            kind: job.event_type === "comment.received" ? "comment" : "dm",
            mode: job.step === "public" ? "comment" : job.event_type === "comment.received" ? "private" : "message",
            targetRef: job.event_type === "comment.received" ? job.activity_ref : null });
          if (found) await finish("sent", null, found.ref);
          else await finish("unknown", "provider_error", null, 30);
        } catch { await finish("unknown", "provider_error", null, 30); }
        continue;
      }
      const config = rule.data;
      try {
        const evidence = await fake.readAutoDmEvidence(credential, { ...account, kind: job.event_type, subjectRef: job.subject_ref, activityRef: job.activity_ref });
        const sameTrigger = evidence && (config.trigger === evidence.trigger ||
          (config.trigger === "welcome" && evidence.trigger === "dm" && evidence.firstInbound));
        if (!evidence || !sameTrigger || evidence.targetRef !== job.activity_ref ||
            (evidence.conversationRef === null ? evidence.postRef !== job.subject_ref : evidence.conversationRef !== job.subject_ref) ||
            (config.entryKey && config.entryKey !== evidence.entryKey) ||
            ((config.postRef || job.provider_post_ref) && (config.postRef || job.provider_post_ref) !== evidence.postRef) ||
            Math.abs(evidence.at.getTime() - new Date(job.occurred_at).getTime()) > 300_000) {
          await finish("skipped", "ineligible"); continue;
        }
        recipient = createHmac("sha256", recipientKey).update(JSON.stringify([job.tenant_id, job.connection_id, evidence.recipientRef])).digest("hex");
        conversation = evidence.conversationRef;
        const matched = matchAutoDm(config.match, evidence.text);
        if (matched !== "matched") { await finish("skipped", matched === "stop" ? "suppressed" : "ineligible"); continue; }
        const instant = now();
        const outside = config.hours !== "ignore" && job.timezone && job.hours && !autoDmOpen(instant, { timezone: job.timezone, hours: job.hours });
        if (outside && (config.hours !== "away" || !job.away_template || job.step !== "primary")) {
          await finish("skipped", "outside_hours"); continue;
        }
        if (config.handoffUserId) { await finish("handed_off"); continue; }
        const target = conversation ?? evidence.postRef;
        if (!target) { await finish("skipped", "ineligible"); continue; }
        const query: InboxReplyQuery = { ...account, ref: target, kind: conversation ? "dm" : "comment",
          mode: job.step === "public" ? "comment" : conversation ? "message" : "private", targetRef: conversation ? null : evidence.targetRef };
        const eligibility = await fake.inboxReplyEligibility(credential, query);
        const standard = new Date(Math.min(evidence.at.getTime(), new Date(job.occurred_at).getTime()) + (conversation ? 24 : 168) * 3_600_000);
        if (!eligibility.allowed || eligibility.humanAgent || standard <= instant || evidence.at > instant) {
          await finish("skipped", "ineligible"); continue;
        }
        const expiry = eligibility.expiresAt && eligibility.expiresAt < standard ? eligibility.expiresAt : standard;
        const authored = outside ? job.away_template : job.step === "public" ? config.response.publicReply
          : job.step === "followup" ? config.response.followup?.text : config.response.text;
        if (!authored || authored.length > 1_000 || /{{|}}/.test(authored.replace(/{{\s*firstName\s*}}/g, ""))) {
          await finish("skipped", "ineligible"); continue;
        }
        let attachment: InboxMedia | undefined;
        if (job.step === "primary" && config.response.fileId && !outside) {
          const mime = job.file_mime;
          const max = mime === "video/mp4" ? 16_000_000 : 8_000_000;
          if (!eligibility.media || !media || !job.file_id || !job.file_key || !mime || !job.file_size || job.file_size > max
            || !["image/jpeg", "image/png", "video/mp4"].includes(mime)) {
            await finish("skipped", "ineligible"); continue;
          }
          const release = await media(job.file_key, mime);
          const url = new URL(release.url);
          if (url.protocol !== "https:" || url.username || url.password || release.expiresAt <= now()) {
            await finish("queued", "provider_error", null, 30); continue;
          }
          attachment = { type: mime === "video/mp4" ? "video" : "image", url: release.url };
        }
        const rendered = renderAutoDm(authored, evidence.firstName);
        const quickReplies = job.step === "primary" && !outside ? config.response.quickReplies : undefined;
        const requestHash = createHmac("sha256", recipientKey).update(JSON.stringify([
          idempotencyKey, recipient, rendered, attachment ? job.file_id : null, quickReplies,
        ])).digest("hex");
        const { rows: [{ state }] } = await pool.query<{ state: string }>(
          "select public.social_auto_dm_begin($1,$2,$3,$4,$5,$6,$7,$8,$9) as state",
          [...params, recipient, conversation, expiry, job.policy_revision ?? 0, outside ? "away" : "rule", requestHash]);
        if (state !== "dispatch") { await finish("skipped", state); continue; }
        try {
          const sent = await fake.dispatchInboxReply(credential, { ...query, idempotencyKey,
            text: rendered, attachment, quickReplies });
          await finish("sent", null, sent.ref);
        } catch (error) {
          if (error instanceof SocialProviderError && error.code === "RATE_LIMITED")
            await finish("queued", "provider_error", null, Math.max(30, Math.ceil((error.retryAfterMs ?? 0) / 1000)));
          else if (error instanceof SocialProviderError && !error.retryable && error.code !== "CONFLICT") await finish("skipped", "provider_error");
          else await finish("unknown", "provider_error", null, 30);
        }
      } catch (error) {
        if (error instanceof SocialProviderError && error.retryable)
          await finish("queued", "provider_error", null, Math.max(30, Math.ceil((error.retryAfterMs ?? 0) / 1000)));
        else await finish("skipped", "provider_error");
      }
    } catch { result.worker_error = (result.worker_error ?? 0) + 1; }
  }
  return result;
}
