import { credentialBinding, openCredential } from "./credential-envelope";
import { SocialProviderError, type SocialProvider } from "./port";
import { classifyFailure, retryDelaySeconds } from "./state";
import { socialPlatforms, socialProviders, type MediaRef, type SocialPlatform, type SocialProviderId } from "./types";

// The posting worker. It runs as the harvest_worker database role: no table privileges, only the two definer functions below.
// The provider call happens OUTSIDE any transaction. Delivery is at-most-once by construction:
//  * every attempt for a post sends the same idempotency key, and the provider returns the original within 24 hours;
//  * a claim whose worker died is retried only inside 23 hours of the first attempt (see social_publish_claim), never later;
//  * an accepted post is reconciled by asking the provider for its status, never published again.
type Queryable = { query: <R extends Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: R[] }> };
type Claimed = {
  action: "publish" | "reconcile"; tenantId: string; postId: string; lockToken: string; connectionId: string; provider: SocialProviderId; platform: SocialPlatform;
  accountRef: string; content: string; media: MediaRef[]; idempotencyKey: string; providerPostRef: string | null; attempts: number; maxAttempts: number; envelope: unknown;
};
export type PublisherOptions = { batch?: number; leaseSeconds?: number };
export type PublisherResult = { claimed: number; published: number; accepted: number; retried: number; failed: number; stale: number; errored: number };
export type ProviderFor = (id: SocialProviderId) => SocialProvider;

const RECONCILE_DELAY_SECONDS = 300;
const valid = (c: Claimed) => (socialProviders as readonly string[]).includes(c.provider) && (socialPlatforms as readonly string[]).includes(c.platform);
export async function runSocialPublisher(pool: Queryable, providerFor: ProviderFor, options: PublisherOptions = {}): Promise<PublisherResult> {
  const result: PublisherResult = { claimed: 0, published: 0, accepted: 0, retried: 0, failed: 0, stale: 0, errored: 0 };
  const { rows: [{ claimed }] } = await pool.query<{ claimed: Claimed[] }>("select public.social_publish_claim($1, $2) as claimed", [options.batch ?? 20, options.leaseSeconds ?? 300]);
  result.claimed = claimed.length;
  const complete = async (c: Claimed, outcome: "published" | "accepted" | "retry" | "failed", ref: string | null, error: string | null, delay: number) => {
    const { rows: [{ status }] } = await pool.query<{ status: string }>("select public.social_publish_complete($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7) as status", [c.tenantId, c.postId, c.lockToken, outcome, ref, error, delay]);
    if (status === "stale") result.stale++;
    else if (status === "published") result.published++;
    else if (status === "failed") result.failed++;
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
          const sent = await provider.publishPost(credential, { idempotencyKey: c.idempotencyKey, accountRef: c.accountRef, platform: c.platform, content: c.content, media: c.media });
          if (sent.status === "published") await complete(c, "published", sent.postRef, null, 0);
          else if (sent.status === "failed" || sent.status === "partial" || sent.status === "cancelled") await complete(c, "failed", sent.postRef, sent.status === "partial" ? "PARTIAL_PUBLISH" : "PROVIDER_REJECTED", 0);
          else await complete(c, "accepted", sent.postRef, null, RECONCILE_DELAY_SECONDS);
        }
      } catch (error) {
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
