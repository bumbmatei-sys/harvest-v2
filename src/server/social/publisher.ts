import { publishOptionsInput, type DeliveryPayload } from "../../lib/social/composer";
import { mediaKind, type MediaMetadata } from "../../lib/social/media";
import { destinationErrors, inspectAttachments } from "./compose-validation";
import { credentialBinding, openCredential } from "./credential-envelope";
import { SocialProviderError, type SocialProvider } from "./port";
import { classifyFailure, retryDelaySeconds } from "./state";
import { socialPlatforms, socialProviders, type MediaRef, type SocialPlatform, type SocialProviderId } from "./types";

// The posting worker. It runs as the harvest_worker database role: no table privileges, only narrow definer functions.
// The provider call happens OUTSIDE any transaction. Delivery is at-most-once by construction:
//  * every attempt for a post sends the same idempotency key, and the provider returns the original within 24 hours;
//  * a claim whose worker died is retried only inside 23 hours of the first attempt (see social_publish_claim), never later;
//  * an accepted post is reconciled by asking the provider for its status, never published again.
type Queryable = { query: <R extends Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: R[] }> };
type Claimed = {
  action: "publish" | "reconcile"; tenantId: string; postId: string; lockToken: string; connectionId: string; provider: SocialProviderId; platform: SocialPlatform;
  accountRef: string; content: string; media: MediaRef[]; delivery: DeliveryPayload | null; idempotencyKey: string; providerPostRef: string | null; attempts: number; maxAttempts: number; envelope: unknown;
};
type AuthorizedFile = { id: string; key: string; name: string; mime: string; size: number; metadata: MediaMetadata | null };
export type PublisherOptions = {
  batch?: number;
  leaseSeconds?: number;
  releaseMedia?: (file: AuthorizedFile) => Promise<{ url: string; expiresAt: Date }>;
  now?: () => Date;
};
export type PublisherResult = { claimed: number; published: number; accepted: number; retried: number; failed: number; stale: number; errored: number; unknown?: number };
export type ProviderFor = (id: SocialProviderId) => SocialProvider;

const RECONCILE_DELAY_SECONDS = 300;
const valid = (c: Claimed) => (socialProviders as readonly string[]).includes(c.provider) && (socialPlatforms as readonly string[]).includes(c.platform);
export async function runSocialPublisher(pool: Queryable, providerFor: ProviderFor, options: PublisherOptions = {}): Promise<PublisherResult> {
  const result: PublisherResult = { claimed: 0, published: 0, accepted: 0, retried: 0, failed: 0, stale: 0, errored: 0 };
  const { rows: [{ claimed }] } = await pool.query<{ claimed: Claimed[] }>("select public.social_publish_claim($1, $2) as claimed", [options.batch ?? 20, options.leaseSeconds ?? 300]);
  result.claimed = claimed.length;
  const complete = async (c: Claimed, outcome: "published" | "accepted" | "retry" | "failed" | "unknown", ref: string | null, error: string | null, delay: number) => {
    const { rows: [{ status }] } = await pool.query<{ status: string }>("select public.social_publish_complete($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7) as status", [c.tenantId, c.postId, c.lockToken, outcome, ref, error, delay]);
    if (status === "stale") result.stale++;
    else if (status === "published") result.published++;
    else if (status === "failed") result.failed++;
    else if (status === "unknown") result.unknown = (result.unknown ?? 0) + 1;
    else if (outcome === "accepted") result.accepted++;
    else result.retried++;
  };
  for (const c of claimed) {
    try {
      if (!valid(c)) { await complete(c, "failed", null, "PROVIDER_REJECTED", 0); continue; }
      let credential;
      try { credential = openCredential(c.envelope, credentialBinding(c.tenantId, c.connectionId)); }
      catch { await complete(c, "failed", null, "CREDENTIAL_UNAVAILABLE", 0); continue; }
      const provider = providerFor(c.provider);
      try {
        if (c.action === "reconcile") {
          const status = await provider.getPostStatus(credential, c.providerPostRef!);
          if (status.status === "published") await complete(c, "published", null, null, 0);
          else if (status.status === "failed" || status.status === "partial") await complete(c, "failed", null, status.status === "partial" ? "PARTIAL_PUBLISH" : "PROVIDER_REJECTED", 0);
          else if (status.status === "cancelled") await complete(c, "failed", null, "PROVIDER_REJECTED", 0);
          else await complete(c, "accepted", null, null, RECONCILE_DELAY_SECONDS);
        } else {
          let media = c.media;
          let coverUrl: string | undefined;
          const delivery = c.delivery;
          if (delivery) {
            const result = await pool.query<{ files: AuthorizedFile[] | null }>("select public.social_publish_media($1, $2, $3) as files", [c.tenantId, c.postId, c.lockToken]);
            const files = result.rows[0].files;
            if (!files) { await complete(c, "failed", null, "CONNECTION_UNAVAILABLE", 0); continue; }
            const byId = new Map(files.map(file => [file.id, { ...file, ...file.metadata }]));
            const checked = inspectAttachments(c.platform, delivery.type, delivery.options, delivery.media, byId);
            if (checked.results.some(file => !file.accepted) || checked.subtitles.some(file => !file.accepted) || checked.issues.length || (checked.cover && !checked.cover.accepted)) {
              await complete(c, "failed", null, "MEDIA_UNAVAILABLE", 0);
              continue;
            }
            if (destinationErrors(c.platform, delivery.type, c.content, delivery.options, checked.media).errors.length) {
              await complete(c, "failed", null, "PROVIDER_REJECTED", 0);
              continue;
            }
            try {
              const signed = await Promise.all(files.map(async file => {
                if (!options.releaseMedia) throw new SocialProviderError("MEDIA_EXPIRED");
                const release = await options.releaseMedia(file);
                return [file.id, release] as const;
              }));
              const now = (options.now ?? (() => new Date()))();
              if (signed.some(([, release]) => !Number.isFinite(release.expiresAt.getTime()) || release.expiresAt <= now ||
                !/^https:\/\//i.test(release.url))) throw new SocialProviderError("MEDIA_EXPIRED");
              const urls = new Map(signed.map(([id, release]) => [id, release.url]));
              coverUrl = delivery.options?.coverFileId ? urls.get(delivery.options.coverFileId) : undefined;
              const subtitles = checked.subtitles.map(track => ({ url: urls.get(track.fileId)!, language: track.language }));
              media = delivery.media.map(attachment => {
                const kind = mediaKind(byId.get(attachment.fileId)!.mime);
                return { kind, url: urls.get(attachment.fileId)!,
                  ...(attachment.altText !== undefined ? { altText: attachment.altText } : {}),
                  ...(kind === "video" && coverUrl ? { thumbnailUrl: coverUrl } : {}),
                  ...(kind === "video" && subtitles.length ? { subtitles } : {}),
                };
              });
            } catch {
              await complete(c, "retry", null, "MEDIA_URL_EXPIRED", retryDelaySeconds(c.attempts));
              continue;
            }
          }
          const publishOptions = delivery?.options ? publishOptionsInput.omit({ repost: true, coverFileId: true, subtitles: true }).strip().parse(delivery.options) : undefined;
          const sent = await provider.publishPost(credential, {
            idempotencyKey: c.idempotencyKey, accountRef: c.accountRef, platform: c.platform, content: c.content, media,
            ...(delivery ? { draftType: delivery.type, options: publishOptions, coverUrl } : {}),
          });
          if (sent.status === "published") await complete(c, "published", sent.postRef, null, 0);
          else if (sent.status === "failed" || sent.status === "partial" || sent.status === "cancelled") await complete(c, "failed", sent.postRef, sent.status === "partial" ? "PARTIAL_PUBLISH" : "PROVIDER_REJECTED", 0);
          else await complete(c, "accepted", sent.postRef, null, RECONCILE_DELAY_SECONDS);
        }
      } catch (error) {
        if (c.delivery && c.action === "publish" && (!(error instanceof SocialProviderError) || error.code === "UNAVAILABLE" || error.code === "CONFLICT")) {
          await complete(c, "unknown", null, null, 0);
          continue;
        }
        if (error instanceof SocialProviderError && error.code === "MEDIA_EXPIRED" && c.action === "publish") {
          await complete(c, "retry", null, "MEDIA_URL_EXPIRED", retryDelaySeconds(c.attempts));
          continue;
        }
        const outcome = c.action === "reconcile"
          // A failed status read never fails the post: the provider has it. Look again later.
          ? { outcome: "accepted" as const, code: null, delaySeconds: retryDelaySeconds(1) * 2 }
          : classifyFailure(error instanceof SocialProviderError ? error : null, c.attempts);
        if (outcome.outcome === "accepted") await complete(c, "accepted", null, null, outcome.delaySeconds);
        else await complete(c, outcome.outcome, null, outcome.code, outcome.delaySeconds);
      }
    } // Counts only: never log the post, the credential or the error. An unrecorded outcome is recovered by the lease.
    catch { result.errored++; }
  }
  return result;
}
