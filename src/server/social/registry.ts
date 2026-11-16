import { AccessError } from "../permissions";
import { message } from "../../i18n/messages";
import type { SocialProvider, SocialSender } from "./port";
import type { SocialProviderId } from "./types";
import { ZernioAdapter } from "./zernio-adapter";

// Intentionally a constant, not an environment toggle (same pattern as MANAGED_KEY_SERVICE_ENABLED, COMMUNITY_EMAIL_LIVE_DELIVERY).
// While false every social API route and the webhook answer the same unavailable response and nothing is linked, scheduled or sent.
// Enabling needs a separate change: DPA, sandbox verification, key ownership, rate-limit plan and independent security review.
export const SOCIAL_INTEGRATION_ENABLED = false;

export type SocialDeps = {
  enabled: boolean;
  /** Provider by id. The default builds only the vendor adapter, which is itself hard-disabled and is built with no transport override here. */
  provider: (id: SocialProviderId) => SocialProvider;
  now: () => Date;
};
export const defaultSocialDeps = (): SocialDeps => ({
  enabled: SOCIAL_INTEGRATION_ENABLED,
  provider: (id) => { if (id === "zernio") return new ZernioAdapter(); throw new AccessError(404, message("Errors.workspaceUnavailable")); },
  now: () => new Date(),
});
export const assertEnabled = (deps: SocialDeps) => { if (!deps.enabled) throw new AccessError(404, message("Errors.workspaceUnavailable")); };

/** Nothing hands out a sender: replies and Auto-DMs are a later feature gated by the consent layer. */
export function getSocialSender(): SocialSender { throw new Error("SOCIAL_SENDING_NOT_AVAILABLE"); }
