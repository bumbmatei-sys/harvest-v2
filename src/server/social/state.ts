import { SocialProviderError } from "./port";

export const postStatuses = ["draft", "scheduled", "publishing", "published", "failed", "cancelled"] as const;
export type PostStatus = typeof postStatuses[number];
export const postErrorCodes = ["PROVIDER_AUTH", "PROVIDER_REJECTED", "PROVIDER_CONFLICT", "PROVIDER_UNAVAILABLE", "PROVIDER_RATE_LIMITED", "MAX_ATTEMPTS", "IDEMPOTENCY_WINDOW_EXPIRED", "CONNECTION_UNAVAILABLE", "PARTIAL_PUBLISH", "DISABLED", "CREDENTIAL_UNAVAILABLE", "UNCONFIRMED"] as const;
export type PostErrorCode = typeof postErrorCodes[number];

// Mirrors the trigger in migration 0049 (the database is the guard; this is for the service and for tests that compare the two).
// `publishing` -> `publishing` is the accepted-awaiting-final-answer move and needs a provider reference.
export const legalTransitions: Record<PostStatus, readonly PostStatus[]> = {
  draft: ["draft", "scheduled", "cancelled"],
  scheduled: ["draft", "scheduled", "publishing", "failed", "cancelled"],
  publishing: ["published", "failed", "scheduled", "publishing"],
  published: [],
  failed: ["scheduled", "cancelled"],
  cancelled: [],
};
export const canTransition = (from: PostStatus, to: PostStatus) => legalTransitions[from].includes(to);

export type Outcome = { outcome: "retry" | "failed"; code: PostErrorCode; delaySeconds: number };
/** Exponential backoff in seconds: 30, 60, 120 ... capped at one hour. */
export const retryDelaySeconds = (attempt: number) => Math.min(3600, 30 * 2 ** Math.max(0, Math.min(attempt - 1, 10)));
/** What the worker does after a failed provider call. Anything that is not a recognised provider error is treated as transient. */
export function classifyFailure(error: unknown, attempt: number): Outcome {
  const backoff = retryDelaySeconds(attempt);
  if (!(error instanceof SocialProviderError)) return { outcome: "retry", code: "PROVIDER_UNAVAILABLE", delaySeconds: backoff };
  switch (error.code) {
    case "RATE_LIMITED": return { outcome: "retry", code: "PROVIDER_RATE_LIMITED", delaySeconds: Math.min(3600, Math.max(backoff, Math.ceil((error.retryAfterMs ?? 0) / 1000))) };
    case "UNAVAILABLE": return { outcome: "retry", code: "PROVIDER_UNAVAILABLE", delaySeconds: backoff };
    case "AUTH": return { outcome: "failed", code: "PROVIDER_AUTH", delaySeconds: 0 };
    case "CONFLICT": return { outcome: "failed", code: "PROVIDER_CONFLICT", delaySeconds: 0 };
    case "DISABLED": return { outcome: "failed", code: "DISABLED", delaySeconds: 0 };
    default: return { outcome: "failed", code: "PROVIDER_REJECTED", delaySeconds: 0 };
  }
}
