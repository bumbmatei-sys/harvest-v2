import type { SocialPlatform } from "../../lib/social/platforms";
import { inboxCapabilities } from "../../lib/social/platforms";
import { inboxModes, replyCapability } from "./inbox-access";
import { credentialBinding, openCredential } from "./credential-envelope";
import type { InboxMedia, InboxReference, InboxReplyMode, InboxReplyQuery } from "./inbox-contract";
import { matchesFingerprint } from "./inbox-tokens";
import { handoffKey, type ReplyHandoff } from "./inbox-reply-handoff";
import { SocialProviderError, type SocialProvider, type SocialSender } from "./port";
import { retryDelaySeconds } from "./state";
import type { SocialProviderId } from "./types";

type Queryable = { query: <R extends Record<string, unknown>>(query: string, values: unknown[]) => Promise<{ rows: R[] }> };
type Job = { tenantId: string; id: string; itemId: string; leaseId: string; state: "leased" | "unknown"; kind: InboxReference["kind"];
  providerRef: string; provider: SocialProviderId; platform: SocialPlatform; connectionId: string; accountRef: string; envelope: unknown;
  mode: InboxReplyMode; targetRef: string | null; fingerprint: string; attempts: number };
type File = { id: string; key: string; name: string; mime: string; size: number };
type Outcome = "confirmed" | "cancelled" | "failed" | "retry" | "unknown";
type Options = { handoff: ReplyHandoff; fake: SocialProvider & SocialSender & { readonly id: "fake" }; batch?: number;
  now?: () => Date; releaseMedia?: (file: File) => Promise<{ url: string; expiresAt: Date }> };

const limits: Record<InboxMedia["type"], number> = { image: 10_000_000, video: 16_000_000, audio: 16_000_000, file: 25_000_000 };
function attachmentType(file: File) {
  if (/^image\/(jpeg|png|webp|gif)$/.test(file.mime)) return "image";
  if (/^video\/(mp4|quicktime)$/.test(file.mime)) return "video";
  if (/^audio\//.test(file.mime)) return "audio";
  if (file.mime === "application/pdf") return "file";
  return null;
}

/** The worker role can claim and complete this job through narrow SQL functions. It runs with an injected fake only. */
export async function runSocialInboxReplies(pool: Queryable, options: Options) {
  const { fake, handoff } = options;
  if (fake.id !== "fake") throw new Error("SOCIAL_SENDING_NOT_AVAILABLE");
  const now = options.now ?? (() => new Date());
  const { rows: [{ jobs }] } = await pool.query<{ jobs: Job[] }>(
    "select public.social_inbox_claim($1,$2) as jobs", [handoff.available(), options.batch ?? 5]);
  const counts: Record<string, number> = { leased: jobs.length };
  for (const job of jobs) {
    const params = [job.tenantId, job.id, job.leaseId];
    const key = handoffKey(job.tenantId, job.id);
    const idempotencyKey = `harvest-inbox:${key}`;
    const finish = async (outcome: Outcome, ref: string | null = null, delay = 0) => {
      const { rows: [{ state }] } = await pool.query<{ state: string }>(
        "select public.social_inbox_complete_reply($1,$2,$3,$4,$5,$6) as state", [...params, outcome, ref, delay]);
      counts[state] = (counts[state] ?? 0) + 1;
      if (!["queued", "stale"].includes(state)) handoff.forget(key);
    };
    try {
      if (job.provider !== fake.id) { await finish("failed"); continue; }
      const credential = openCredential(job.envelope, credentialBinding(job.tenantId, job.connectionId));
      const signal = AbortSignal.timeout(8_000);
      const query: InboxReplyQuery = { accountRef: job.accountRef, platform: job.platform, kind: job.kind, ref: job.providerRef,
        mode: job.mode, targetRef: job.targetRef, signal };
      if (job.state === "unknown") {
        try {
          const result = await fake.reconcileInboxReply(credential, { ...query, idempotencyKey });
          if (result) await finish("confirmed", result.ref);
          else await finish("unknown", null, 30);
        } catch { await finish("unknown", null, 30); }
        continue;
      }
      const transient = handoff.read(key);
      if (!transient) { await finish("retry", null, 1); continue; }
      if (transient.itemId !== job.itemId || !matchesFingerprint(transient, job.fingerprint)) { await finish("failed"); continue; }
      const caps = inboxCapabilities(job.platform);
      if (!inboxModes[job.kind].includes(job.mode) || caps[replyCapability[job.mode]] === "unavailable") {
        await finish("failed"); continue;
      }
      let eligible;
      try { eligible = await fake.inboxReplyEligibility(credential, query); }
      catch (error) {
        if (error instanceof SocialProviderError && error.retryable) {
          await finish("retry", null, Math.max(30, Math.ceil((error.retryAfterMs ?? 0) / 1000)));
        } else await finish("failed");
        continue;
      }
      if (!eligible.allowed || (eligible.expiresAt && eligible.expiresAt <= now())
        || (job.mode === "message" && job.targetRef && (!eligible.quote || caps.quoteReply === "unavailable"))) {
        await finish("cancelled"); continue;
      }
      if (job.platform === "tiktok" && job.mode === "message" && (transient.text.length > 6_000 || (transient.text && transient.fileId))) {
        await finish("failed"); continue;
      }
      let attachment: InboxMedia | undefined;
      if (transient.fileId) {
        const { rows: [{ file }] } = await pool.query<{ file: File | null }>("select public.social_inbox_reply_file($1,$2,$3) as file", params);
        const type = file && attachmentType(file);
        const exactMime = file && ["image/jpeg", "image/png"].includes(file.mime);
        const exceedsPlatform = file && ((job.platform === "tiktok" && (!exactMime || file.size > 3_000_000)) ||
          (job.platform === "instagram" && (type === "image" ? !exactMime || file.size > 8_000_000 : file.size > 25_000_000)));
        if (!file || !type || exceedsPlatform || !eligible.media || !options.releaseMedia || file.size > limits[type]
          || (job.mode === "comment" && (type !== "image" || caps.commentMedia === "unavailable"))
          || (job.mode === "message" && caps.messageMedia === "unavailable")
          || (job.mode !== "message" && job.mode !== "comment")) { await finish("failed"); continue; }
        try {
          const release = await options.releaseMedia(file);
          const url = new URL(release.url);
          if (url.protocol !== "https:" || url.username || url.password || !(release.expiresAt > now())) throw new Error();
          attachment = { type, url: release.url };
        } catch { await finish("retry", null, 30); continue; }
      }
      const { rows: [{ allowed }] } = await pool.query<{ allowed: boolean }>(
        "select public.social_inbox_begin_reply($1,$2,$3,$4) as allowed", [...params, eligible.expiresAt]);
      if (!allowed) { await finish("cancelled"); continue; }

      // The SQL claim is the last authorization point. Provider I/O occurs after its transaction has ended.
      try {
        const sent = await fake.dispatchInboxReply(credential, { ...query, text: transient.text, attachment,
          humanAgent: eligible.humanAgent, mediaRef: eligible.mediaRef, idempotencyKey });
        await finish("confirmed", sent.ref);
      } catch (error) {
        if (error instanceof SocialProviderError && error.code === "RATE_LIMITED") {
          await finish("retry", null, Math.max(retryDelaySeconds(job.attempts + 1), Math.ceil((error.retryAfterMs ?? 0) / 1000)));
        } else if (error instanceof SocialProviderError && ["AUTH", "EXPIRED", "DISABLED", "UNSUPPORTED", "NOT_FOUND", "INVALID_REQUEST"].includes(error.code)) {
          await finish("failed");
        } else await finish("unknown", null, 5);
      }
    } catch {
      // A lost claim can be recovered by lease expiry. Never log request text, credentials or provider errors.
      counts.error = (counts.error ?? 0) + 1;
    }
  }
  return counts;
}
